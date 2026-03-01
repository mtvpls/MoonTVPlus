'use client';

import { useEffect, useRef, useState } from 'react';

type Rocket = {
  x: number;
  y: number;
  speed: number;
  targetY: number;
  hue: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  hue: number;
};

const FireworksCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const runtimeEnabled =
      (window as any).RUNTIME_CONFIG?.FESTIVE_EFFECT_ENABLED === true;

    const start = new Date(2026, 1, 16, 0, 0, 0);
    const end = new Date(2026, 2, 3, 23, 59, 59, 999);
    const now = new Date();
    if (runtimeEnabled || (now >= start && now <= end)) {
      setActive(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = window.devicePixelRatio || 1;

    const setSize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    setSize();
    window.addEventListener('resize', setSize);

    const rockets: Rocket[] = [];
    const particles: Particle[] = [];
    let lastLaunchTime = 0;

    const launchRocket = () => {
      rockets.push({
        x: Math.random() * width,
        y: height + 24,
        speed: 3 + Math.random() * 1.8,
        targetY: height * (0.4 + Math.random() * 0.4),
        hue: Math.random() * 360,
      });
    };

    const explode = (rocket: Rocket) => {
      const count = 36 + Math.floor(Math.random() * 20);
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 1 + Math.random() * 1.8;
        particles.push({
          x: rocket.x,
          y: rocket.targetY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          ttl: 60 + Math.random() * 30,
          hue: rocket.hue,
        });
      }
    };

    let animationFrame = 0;
    const animate = (time: number) => {
      context.clearRect(0, 0, width, height);

      if (time - lastLaunchTime > 700 + Math.random() * 500) {
        if (rockets.length < 4) launchRocket();
        lastLaunchTime = time;
      }

      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const rocket = rockets[i];
        const previousY = rocket.y;
        rocket.y -= rocket.speed;

        context.strokeStyle = `hsla(${rocket.hue}, 100%, 70%, 0.85)`;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(rocket.x, previousY + 4);
        context.lineTo(rocket.x, rocket.y);
        context.stroke();

        if (rocket.y <= rocket.targetY) {
          rockets.splice(i, 1);
          explode(rocket);
        }
      }

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.life += 1;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.03;

        const alpha = Math.max(0, 1 - particle.life / particle.ttl);
        context.fillStyle = `hsla(${particle.hue}, 100%, 65%, ${alpha})`;
        context.beginPath();
        context.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
        context.fill();

        if (particle.life >= particle.ttl) {
          particles.splice(i, 1);
        }
      }

      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', setSize);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className='fixed inset-0 z-30 pointer-events-none'
      aria-hidden='true'
    />
  );
};

export default FireworksCanvas;
