'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';

const dockerRunExample = `docker run -d \\
  --name tvbox-bridge \\
  --restart unless-stopped \\
  -p 8787:8787 \\
  -e BRIDGE_TOKEN="replace-with-your-token" \\
  -v "$PWD/tvbox-bridge-data:/data" \\
  mtvdkr/tvbox-bridge`;

const composeExample = `services:
  tvbox-bridge:
    image: mtvdkr/tvbox-bridge
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      BRIDGE_TOKEN: "replace-with-your-token"
      # 可选：桥接服务的反向代理 / 公网地址
      # PUBLIC_BASE_URL: "https://bridge.example.com"
      # 可选：拉取 GitHub 配置与 spider 载荷的代理
      # HTTPS_PROXY: "http://proxy.example.com:7890"
      # HTTP_PROXY: "http://proxy.example.com:7890"
    volumes:
      - ./tvbox-bridge-data:/data`;

const environmentVariables = [
  {
    name: 'BRIDGE_TOKEN',
    required: '必填',
    description: '鉴权 Token，需与管理页「连接设置」中的 Token 保持一致。',
  },
  {
    name: 'PUBLIC_BASE_URL',
    required: '可选',
    description: '桥接服务的反向代理 / 公网地址，用于生成绝对 streamUrl。',
  },
  {
    name: 'HTTPS_PROXY / HTTP_PROXY',
    required: '可选',
    description: '用于拉取 GitHub 配置与 spider 载荷。',
  },
];

interface TVBoxBridgeDeployDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function TVBoxBridgeDeployDialog({
  open,
  onClose,
}: TVBoxBridgeDeployDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className='relative z-[10000]'>
      <div className='fixed inset-0 bg-black/50' aria-hidden='true' />
      <div className='fixed inset-0 flex items-center justify-center p-4'>
        <DialogPanel className='flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900'>
          <div className='flex items-center justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700'>
            <DialogTitle className='text-lg font-semibold text-gray-900 dark:text-white'>
              TVBox 桥接部署教程
            </DialogTitle>
            <button
              type='button'
              onClick={onClose}
              aria-label='关闭部署教程'
              className='rounded-lg p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-gray-400 dark:hover:bg-gray-800'
            >
              <X size={20} aria-hidden='true' />
            </button>
          </div>

          <div className='min-h-0 space-y-5 overflow-y-auto p-4 text-sm text-gray-700 dark:text-gray-300 sm:p-6'>
            <div className='space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200'>
              <p className='font-medium'>仅支持 Docker 部署。</p>
              <p>
                Docker 镜像包含 Java、Node.js 和 Python环境，以支持多方式源。
              </p>
            </div>

            <section className='space-y-2'>
              <h3 className='font-semibold text-gray-900 dark:text-white'>
                1. Docker Run 一步部署
              </h3>
              <p>
                将 replace-with-your-token 替换为自己的 Token 后执行以下命令。
              </p>
              <pre className='overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100'>
                <code>{dockerRunExample}</code>
              </pre>
            </section>

            <section className='space-y-2'>
              <h3 className='font-semibold text-gray-900 dark:text-white'>
                2. 环境变量
              </h3>
              <div className='overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700'>
                <table className='w-full text-left text-xs'>
                  <thead className='bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-white'>
                    <tr>
                      <th scope='col' className='px-3 py-2'>
                        变量
                      </th>
                      <th scope='col' className='whitespace-nowrap px-3 py-2'>
                        要求
                      </th>
                      <th scope='col' className='min-w-[200px] px-3 py-2'>
                        说明
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                    {environmentVariables.map((variable) => (
                      <tr key={variable.name}>
                        <th
                          scope='row'
                          className='px-3 py-2 align-top font-mono font-normal'
                        >
                          {variable.name}
                        </th>
                        <td className='whitespace-nowrap px-3 py-2 align-top'>
                          {variable.required}
                        </td>
                        <td className='px-3 py-2'>{variable.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className='space-y-2'>
              <h3 className='font-semibold text-gray-900 dark:text-white'>
                3. Docker Compose 示例
              </h3>
              <p>
                Docker Run 与 Docker Compose 选择一种方式部署即可。
                将以下内容保存为 compose.yaml，将 replace-with-your-token
                替换为自己的 Token。可选变量按需取消注释并填写实际地址。
              </p>
              <pre className='overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100'>
                <code>{composeExample}</code>
              </pre>
              <p>
                示例将当前目录下的 tvbox-bridge-data 挂载到容器 /data 目录。在
                compose.yaml 所在目录执行：
              </p>
              <pre className='overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100'>
                <code>docker compose up -d</code>
              </pre>
            </section>

            <section className='space-y-2'>
              <h3 className='font-semibold text-gray-900 dark:text-white'>
                4. 连接桥接
              </h3>
              <ol className='list-decimal space-y-3 pl-5'>
                <li className='space-y-2'>
                  <p>在管理页填写 MoonTVPlus 服务端可访问的桥接地址，例如：</p>
                  <pre className='overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100'>
                    <code>http://服务器IP:8787</code>
                  </pre>
                  <p>如果 MoonTVPlus 与桥接位于同一 Docker 网络，也可填写：</p>
                  <pre className='overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100'>
                    <code>http://tvbox-bridge:8787</code>
                  </pre>
                </li>
                <li>
                  填写与 <code className='font-mono'>BRIDGE_TOKEN</code> 一致的
                  Token。
                </li>
                <li>保存连接设置后查看状态，再加载 TVBox 配置。</li>
              </ol>
            </section>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
