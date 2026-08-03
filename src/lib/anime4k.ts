// 自管理 WebGPU 超分渲染器：逐帧从 <video> 取图（必要时经 createImageBitmap 中转）
// 送入 anime4k-webgpu 管线放大后绘制到 canvas。
//
// 参考 Anime4K-WebExtension 的 renderer.ts 实现，解决 Firefox 下
// copyExternalImageToTexture({ source: DOM video/canvas }) 不可用的问题：
// Firefox 只可靠支持用 ImageBitmap 作为外部图像源，因此做主循环前先用
// canCopyExternalImageToTexture() 探测；探测失败则退回 createImageBitmap(video) 路径。
import type { Anime4KPipeline } from 'anime4k-webgpu';

export interface Anime4KModeConstructor {
  new (args: {
    device: GPUDevice;
    inputTexture: GPUTexture;
    nativeDimensions: { width: number; height: number };
    targetDimensions: { width: number; height: number };
  }): Anime4KPipeline;
}

export interface Anime4KRendererOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  /** 超分倍数，输出尺寸 = 视频原生尺寸 * scale */
  scale: number;
  /** Anime4K 模式类，如 anime4k-webgpu 的 ModeA / ModeB ... */
  pipelineClass: Anime4KModeConstructor;
}

export interface Anime4KController {
  stop: () => void;
}

const fullscreenTexturedQuadWGSL = `
struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) fragUV : vec2<f32>,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  const pos = array(
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2(-1.0,  1.0),
  );

  const uv = array(
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 0.0),
  );

  var output : VertexOutput;
  output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
  output.fragUV = uv[VertexIndex];
  return output;
}
`;

const sampleExternalTextureWGSL = `
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

@fragment
fn main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(myTexture, mySampler, fragUV);
}
`;

/**
 * 探测当前 WebGPU 实现是否支持把画面拷贝进外部纹理。
 * Firefox 不支持直接从 DOM video/canvas 拷贝，但支持 ImageBitmap，因此用它决定回退路径。
 */
async function canCopyExternalImageToTexture(): Promise<boolean> {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) return false;

    const offscreen = new OffscreenCanvas(1, 1);
    const ctx = offscreen.getContext('2d') as unknown as CanvasRenderingContext2D | null;
    if (!ctx) return false;
    ctx.fillRect(0, 0, 1, 1);

    // 用 VideoFrame 探测外部图像拷贝支持：Firefox 的 WebGPU（wgpu）不支持把
    // VideoFrame 作为 copyExternalImageToTexture 源，会抛异常 → 主循环退回 ImageBitmap 路径。
    // 旧版 TS lib 没有 VideoFrame 类型，运行时取构造器即可。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const VideoFrameCtor = (window as any).VideoFrame as unknown;
    if (typeof VideoFrameCtor !== 'function') return false;
    const frame = new (VideoFrameCtor as {
      new (source: CanvasImageSource, opts: { timestamp: number }): ImageBitmap;
    })(offscreen, { timestamp: 0 });

    const texture = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture({ source: frame }, { texture }, [1, 1]);

    frame.close();
    texture.destroy();
    device.destroy();
    return true;
  } catch {
    return false;
  }
}

export async function createAnime4KRenderer(
  options: Anime4KRendererOptions
): Promise<Anime4KController> {
  const { video, canvas, scale, pipelineClass } = options;

  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) {
    throw new Error('无法获取视频尺寸');
  }
  const outW = Math.floor(srcW * scale);
  const outH = Math.floor(srcH * scale);
  if (!outW || !outH || !Number.isFinite(outW) || !Number.isFinite(outH)) {
    throw new Error(`输出Canvas尺寸无效: ${outW}x${outH}, scale: ${scale}`);
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU 不支持：无法获取 GPU 适配器');
  }

  // 与播放页相同：请求尽可能大的 buffer 上限（不超过 2GB），兼容 anime4k 管线的高分辨率纹理
  const adapterLimits = adapter.limits;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxBufferSize: Math.min(adapterLimits.maxBufferSize || 2147483648, 2147483648),
      maxStorageBufferBindingSize: Math.min(
        adapterLimits.maxStorageBufferBindingSize || 1073741824,
        1073741824
      ),
    },
  });

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('无法获取 WebGPU canvas 上下文');
  }
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  });

  const inputTexture = device.createTexture({
    size: [srcW, srcH, 1],
    format: 'rgba16float',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const pipeline = new pipelineClass({
    device,
    inputTexture,
    nativeDimensions: { width: srcW, height: srcH },
    targetDimensions: { width: outW, height: outH },
  });

  // 最终合成：把管线输出纹理贴满 canvas
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: fullscreenTexturedQuadWGSL }),
      entryPoint: 'vert_main',
    },
    fragment: {
      module: device.createShaderModule({ code: sampleExternalTextureWGSL }),
      entryPoint: 'main',
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 1, resource: sampler },
      { binding: 2, resource: pipeline.getOutputTexture().createView() },
    ],
  });

  const useImageBitmap = !(await canCopyExternalImageToTexture());

  let destroyed = false;
  let rafId = 0;

  const copyCurrentFrame = async (): Promise<boolean> => {
    if (destroyed || video.readyState < video.HAVE_CURRENT_DATA || video.paused) {
      return false;
    }

    if (useImageBitmap) {
      const bitmap = await createImageBitmap(video);
      try {
        device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture: inputTexture },
          [srcW, srcH]
        );
      } finally {
        bitmap.close();
      }
    } else {
      device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: inputTexture },
        [srcW, srcH]
      );
    }

    const encoder = device.createCommandEncoder();
    pipeline.pass(encoder);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        } as GPURenderPassColorAttachment,
      ],
    });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);

    return true;
  };

  const loop = async (): Promise<void> => {
    if (destroyed) return;
    try {
      await copyCurrentFrame();
    } catch (err) {
      if (!destroyed) {
        // eslint-disable-next-line no-console
        console.error('[Anime4K] 帧处理失败:', err);
      }
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  const stop = (): void => {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(rafId);
    try {
      // Anime4KPipeline 接口未声明 destroy，运行时可安全调用
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any).destroy?.();
    } catch {
      /* 忽略 */
    }
    try {
      inputTexture.destroy();
    } catch {
      /* 忽略 */
    }
    try {
      context.unconfigure();
    } catch {
      /* 忽略 */
    }
    try {
      device.destroy();
    } catch {
      /* 忽略 */
    }
  };

  return { stop };
}