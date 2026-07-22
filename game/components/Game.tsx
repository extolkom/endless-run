"use client";


import { useEffect, useRef, useState, useCallback } from 'react';
import { submitScoreOnChain, fetchTopScores, type TopScore } from '../lib/leaderboard';
import { BORDER_RADIUS, SHADOWS, GRADIENTS, SPACING } from '../lib/styleConstants';

// Ethereum window type
declare global {
  interface Window {
    ethereum: any;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

// Import new obstacle system
import { Obstacle, getSpawnedObstacles, updateObstacle, ObstacleType } from '../lib/obstacles';

// Note: Obstacle interface is now defined in lib/obstacles.ts and includes a 'kind' field.
// The previous ObstacleType enum is removed.

interface Coin {
  x: number; y: number; size: number;
  collected: boolean; bobOffset: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; color: string; size: number;
}

interface GameState {
  isRunning: boolean; isOver: boolean;
  score: number; highScore: number;
  speed: number; distance: number;
  celoEarned: number; totalCeloEarned: number;
  level: number; lastSpeedUp: number;
  lives: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GROUND_RATIO = 0.78;
const P_SIZE = 36;          // player is a square (GD style)
const GRAVITY = 0.62;
const JUMP_FORCE = -14.5;
const JUMP2_FORCE = -12;
const BASE_SPEED = 5;
const CELO_PER_COIN = 0.002;
const COIN_INTERVAL_MS = 16500;       // 16.5 seconds between coins
const FIRST_COIN_MS = 5000;        // first coin at 5 seconds
const SPEEDUP_INTERVAL = 10000;       // speed up every 10 seconds
const SPEED_INCREMENT = 0.8;
const LIVES_COST_CELO = 0.1;         // cost to buy 10 more lives (native CELO path)
// MiniPay is a stablecoin wallet — most users hold no native CELO, so there we
// charge in USDm (Mento Dollar) instead. Set low (0.01 USDm) for live testing.
const LIVES_COST_USDM = 0.01;
// USDm / Mento Dollar on Celo mainnet — verified on-chain: symbol "USDm",
// name "Mento Dollar", 18 decimals. NOT Mountain Protocol's USDM.
const USDM_ADDRESS = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const EXTRA_LIVES = 10;
const MAX_LEVEL = 8;

// Palette
const PAL = {
  bg: '#0a0a12',
  sky: '#0d0d1a',
  ground: '#1a0a2e',
  ground2: '#120820',
  grass: '#7c3aed',
  player: '#39ff14',
  playerG: '#00cc00',
  playerD: '#004400',
  spike: '#e11d48',
  spikeDk: '#9f1239',
  wheel: '#f59e0b',
  wheelDk: '#92400e',
  platform: '#6366f1',
  platDk: '#3730a3',
  coin: '#fbbf24',
  coinShd: '#f59e0b',
  neon: '#39ff14',
  purple: '#a855f7',
  blue: '#3b82f6',
  red: '#ef4444',
  amber: '#f59e0b',
  white: '#ffffff',
  cyan: '#22d3ee',
};

const NINJA_THEME = {
  bg: '#040a1a',
  bgSecondary: '#0b1732',
  accentPrimary: '#39c3ff',
  accentSecondary: '#60a8ff',
  text: '#e6f5ff',
  success: '#50d892',
  error: '#ff5a6d',
};

const FONT_FAMILY = {
  display: '"Vampire Wars", "Press Start 2P", monospace',
  fallback: '"Press Start 2P", monospace',
};

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, shadow = true) {
  ctx.imageSmoothingEnabled = false;
  ctx.font = `${size}px "Press Start 2P", monospace`;
  if (shadow) { ctx.fillStyle = '#000'; ctx.fillText(text, x + 2, y + 2); }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ─── Draw player (GD cube style) ─────────────────────────────────────────────

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  animFrame: number, isDead: boolean,
  jumpCount: number,
  shakeX = 0, shakeY = 0
) {
  ctx.save();
  ctx.translate(Math.round(x + P_SIZE / 2 + shakeX), Math.round(y + P_SIZE / 2 + shakeY));

  // Rotate cube when jumping
  const rot = isDead ? 0.4 : (animFrame * 0.07) % (Math.PI * 2);
  ctx.rotate(rot);
  if (isDead) ctx.globalAlpha = 0.6;

  const h = P_SIZE;

  // Outer cube
  px(ctx, -h / 2, -h / 2, h, h, PAL.playerD);
  // Inner cube face
  px(ctx, -h / 2 + 3, -h / 2 + 3, h - 6, h - 6, PAL.player);
  // Shine
  px(ctx, -h / 2 + 4, -h / 2 + 4, h / 2 - 4, 4, '#fff');
  px(ctx, -h / 2 + 4, -h / 2 + 4, 4, h / 2 - 4, '#fff');
  // Inner diamond
  ctx.fillStyle = PAL.playerG;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(8, 0);
  ctx.lineTo(0, 8);
  ctx.lineTo(-8, 0);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
  }

  // Updated drawObstacle to handle both legacy and new obstacle kinds
  function drawObstacle(ctx: CanvasRenderingContext2D, obs: Obstacle, time: number) {
    ctx.save();
    ctx.translate(Math.round(obs.x), Math.round(obs.y));

    // Legacy types (keep for backward compatibility)
    if ((obs as any).type) {
      const legacy = obs as any;
      if (legacy.type === 'spike') {
        ctx.fillStyle = PAL.spike;
        ctx.beginPath();
        ctx.moveTo(0, legacy.height);
        ctx.lineTo(legacy.width / 2, 0);
        ctx.lineTo(legacy.width, legacy.height);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.spikeDk;
        ctx.fillRect(0, legacy.height - 4, legacy.width, 4);
        ctx.shadowColor = PAL.spike; ctx.shadowBlur = 8; ctx.strokeStyle = '#ff6b8a'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.shadowBlur = 0;
      } else if (legacy.type === 'spike_group') {
        const count = Math.round(legacy.width / 28);
        for (let i = 0; i < count; i++) {
          const sx = i * 28;
          ctx.fillStyle = i % 2 === 0 ? PAL.spike : PAL.spikeDk;
          ctx.beginPath(); ctx.moveTo(sx, legacy.height); ctx.lineTo(sx + 14, 0); ctx.lineTo(sx + 28, legacy.height); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = PAL.spikeDk; ctx.fillRect(0, legacy.height - 4, legacy.width, 4);
      } else if (legacy.type === 'spike_wall') {
        px(ctx, 0, 0, legacy.width, legacy.height, PAL.spikeDk);
        px(ctx, 2, 0, legacy.width - 4, legacy.height - 2, PAL.spike);
        for (let i = 0; i < 2; i++) { ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.moveTo(i * legacy.width / 2, 0); ctx.lineTo(legacy.width / 4 + i * legacy.width / 2, -14); ctx.lineTo(legacy.width / 2 + i * legacy.width / 2, 0); ctx.closePath(); ctx.fill(); }
      } else if (legacy.type === 'rotating_wheel') {
        ctx.save(); ctx.translate(legacy.width / 2, legacy.height / 2); ctx.rotate(legacy.angle || 0);
        const r = legacy.width / 2; ctx.fillStyle = PAL.wheel; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = PAL.wheelDk; ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate((i * Math.PI * 2) / 6); ctx.fillStyle = PAL.amber; ctx.beginPath(); ctx.moveTo(-5, r * 0.35); ctx.lineTo(0, r); ctx.lineTo(5, r * 0.35); ctx.closePath(); ctx.fill(); ctx.restore(); }
        ctx.restore(); ctx.shadowColor = PAL.amber; ctx.shadowBlur = 12; ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(legacy.width / 2, legacy.height / 2, legacy.width / 2, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
      } else if (legacy.type === 'moving_spike') {
        ctx.fillStyle = PAL.purple; ctx.beginPath(); ctx.moveTo(0, legacy.height); ctx.lineTo(legacy.width / 2, 0); ctx.lineTo(legacy.width, legacy.height); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c084fc'; ctx.fillRect(0, legacy.height - 4, legacy.width, 4); ctx.shadowColor = PAL.purple; ctx.shadowBlur = 10; ctx.strokeStyle = '#e879f9'; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0;
      } else if (legacy.type === 'platform_gap') {
        px(ctx, 0, 0, legacy.width, legacy.height, PAL.platDk); px(ctx, 2, 2, legacy.width - 4, legacy.height / 2, PAL.platform); ctx.shadowColor = PAL.blue; ctx.shadowBlur = 8; px(ctx, 0, 0, legacy.width, 4, PAL.cyan); ctx.shadowBlur = 0;
      } else if (legacy.type === 'low_ceiling') {
        px(ctx, 0, 0, legacy.width, legacy.height, PAL.spikeDk); px(ctx, 0, legacy.height - 4, legacy.width, 4, PAL.spike); for (let i = 0; i < Math.floor(legacy.width / 20); i++) { ctx.fillStyle = PAL.spike; ctx.beginPath(); ctx.moveTo(i * 20 + 2, legacy.height); ctx.lineTo(i * 20 + 10, legacy.height + 12); ctx.lineTo(i * 20 + 18, legacy.height); ctx.closePath(); ctx.fill(); }
      }
      ctx.restore();
      return;
    }

    // New obstacle kinds
    switch (obs.kind) {
      case 'tumbleweed': {
        const radius = Math.min(obs.width, obs.height) / 2;
        const bounce = Math.sin(time * 0.005) * 4;
        ctx.fillStyle = '#c2b280';
        ctx.beginPath(); ctx.arc(radius, radius - bounce, radius, 0, Math.PI * 2); ctx.fill();
        // Simple shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(radius, radius + 2, radius, 4, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'sinkhole': {
        // A pit sunk into the ground — shallow ellipse with a depth gradient
        // and a glowing purple rim, so it reads as a hole, not a floating ball.
        const cx = obs.width / 2;
        const cy = obs.height / 2;
        const rx = obs.width / 2;
        const ry = obs.height / 2;

        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
        grad.addColorStop(0, '#000000');
        grad.addColorStop(0.55, '#0a0012');
        grad.addColorStop(1, '#2a1044');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

        // Glowing neon-purple rim to match the ground.
        ctx.strokeStyle = PAL.purple; ctx.lineWidth = 2;
        ctx.shadowColor = PAL.purple; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;

        // Faint near-edge highlight for a touch of depth.
        ctx.strokeStyle = 'rgba(168,85,247,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(cx, cy + 1, rx * 0.7, ry * 0.55, 0, 0, Math.PI); ctx.stroke();
        break;
      }
      case 'meerkat_pack': {
        // Small brown rectangles spaced horizontally
        const count = 3;
        const w = obs.width / count - 4;
        for (let i = 0; i < count; i++) {
          ctx.fillStyle = '#8b4513';
          ctx.fillRect(i * (w + 4), 0, w, obs.height);
        }
        break;
      }
      case 'vulture': {
        // Swooping triangle following sine wave
        const amplitude = 30;
        const yOff = Math.sin(time * 0.003 + obs.x * 0.01) * amplitude;
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.moveTo(0, obs.height / 2 + yOff);
        ctx.lineTo(obs.width / 2, -obs.height / 2 + yOff);
        ctx.lineTo(obs.width, obs.height / 2 + yOff);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'swinging_vine': {
        const swing = Math.sin(time * 0.004 + obs.x * 0.02) * 15;
        ctx.strokeStyle = '#2c7a0b'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(obs.width / 2, 0); ctx.lineTo(obs.width / 2 + swing, obs.height);
        ctx.stroke();
        ctx.fillStyle = '#2c7a0b'; ctx.beginPath(); ctx.arc(obs.width / 2 + swing, obs.height, 6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'drone': {
        ctx.fillStyle = '#00bcd4';
        ctx.fillRect(0, 0, obs.width, obs.height);
        ctx.strokeStyle = '#00796b'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, obs.width, obs.height);
        break;
      }
      case 'rolling_boulder': {
        const radius = Math.min(obs.width, obs.height) / 2;
        ctx.fillStyle = '#777';
        ctx.beginPath(); ctx.arc(radius, radius, radius, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'rival_predator': {
        ctx.fillStyle = '#c62828';
        ctx.fillRect(0, 0, obs.width, obs.height);
        ctx.fillStyle = '#fff'; ctx.font = '10px "Press Start 2P", monospace'; ctx.fillText('🐾', 2, obs.height - 4);
        break;
      }
      case 'baobab_root': {
        // Spiky ground eruptions
        const spikeW = 8;
        const spikeCount = Math.floor(obs.width / spikeW);
        for (let i = 0; i < spikeCount; i++) {
          ctx.fillStyle = '#8d6e63';
          ctx.beginPath();
          ctx.moveTo(i * spikeW, obs.height);
          ctx.lineTo(i * spikeW + spikeW / 2, 0);
          ctx.lineTo((i + 1) * spikeW, obs.height);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'gas_fee_wall': {
        ctx.fillStyle = '#b71c1c';
        ctx.fillRect(0, 0, obs.width, obs.height);
        ctx.fillStyle = '#fff'; ctx.font = '8px "Press Start 2P", monospace'; ctx.fillText('HIGH GAS!', 4, obs.height / 2 + 4);
        break;
      }
      case 'falling_block': {
        ctx.fillStyle = '#37474f';
        ctx.fillRect(0, 0, obs.width, obs.height);
        // optional small highlight
        ctx.strokeStyle = '#607d8b'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, obs.width, obs.height);
        break;
      }
      case 'rug_pull': {
        // Looks like normal ground tile but will drop; draw as normal ground color
        ctx.fillStyle = PAL.ground;
        ctx.fillRect(0, 0, obs.width, obs.height);
        break;
      }
      default: {
        // fallback: simple rectangle
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, obs.width, obs.height);
      }
    }
    ctx.restore();
  }
  // ─── Draw coin ────────────────────────────────────────────────────────────────

  function drawCoin(ctx: CanvasRenderingContext2D, coin: Coin, time: number) {
    if (coin.collected) return;
    const bob = Math.sin(time * 0.003 + coin.bobOffset) * 5;
    ctx.save();
    ctx.translate(Math.round(coin.x + coin.size / 2), Math.round(coin.y + bob + coin.size / 2));

    // Outer glow
    ctx.shadowColor = PAL.coin;
    ctx.shadowBlur = 16;

    // Coin
    ctx.fillStyle = PAL.coinShd;
    ctx.beginPath();
    ctx.arc(0, 0, coin.size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.coin;
    ctx.beginPath();
    ctx.arc(0, 0, coin.size / 2 - 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // C symbol
    ctx.fillStyle = '#92400e';
    ctx.font = `bold ${coin.size * 0.6}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₵', 0, 1);

    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-3, -4, 4, 2, -0.5, 0, Math.PI * 2); ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // ─── Draw background ──────────────────────────────────────────────────────────

  function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, groundY: number, offset: number, level: number) {
    // Sky gradient — shifts with level
    const skyColors = [
      ['#0a0a18', '#0d0d2e'],
      ['#0a0012', '#1a0028'],
      ['#000a10', '#001a28'],
      ['#100008', '#28000a'],
      ['#0a0a00', '#1a1800'],
      ['#000a08', '#001a14'],
      ['#08000a', '#1a0018'],
      ['#000810', '#001428'],
    ];
    const sc = skyColors[Math.min(level - 1, 7)];
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, sc[0]);
    skyGrad.addColorStop(1, sc[1]);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, groundY);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const stars = [40, 15, 120, 40, 200, 20, 300, 55, 420, 10, 520, 35, 640, 25, 750, 50, 860, 18, 960, 42];
    for (let i = 0; i < stars.length; i += 2) {
      const sx = ((stars[i] - offset * 0.04) % W + W) % W;
      const sy = stars[i + 1];
      const blink = Math.sin(offset * 0.01 + i) > 0.7;
      if (blink) ctx.fillStyle = 'rgba(255,255,255,0.4)';
      else ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(Math.round(sx), sy, 2, 2);
    }

    // Neon grid lines on ground — GD style
    ctx.strokeStyle = `rgba(${level % 2 === 0 ? '168,85,247' : '59,130,246'},0.25)`;
    ctx.lineWidth = 1;
    const gridOff = offset % 60;
    for (let i = -1; i < W / 60 + 2; i++) {
      const gx = Math.round(i * 60 - gridOff);
      ctx.beginPath(); ctx.moveTo(gx, groundY); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let row = 0; row < 4; row++) {
      const gy = groundY + row * 20;
      const perspective = 1 - row * 0.15;
      ctx.globalAlpha = perspective * 0.3;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Ground
    const gGrad = ctx.createLinearGradient(0, groundY, 0, H);
    gGrad.addColorStop(0, '#1a0a2e');
    gGrad.addColorStop(0.3, '#0d0520');
    gGrad.addColorStop(1, '#050010');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, groundY, W, H - groundY);

    // Ground top strip — neon
    const levelColors = ['#7c3aed', '#a855f7', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#f43f5e', '#22d3ee'];
    ctx.fillStyle = levelColors[Math.min(level - 1, 7)];
    ctx.fillRect(0, groundY, W, 4);

    // Ground scroll dashes
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    const dashOff = offset % 48;
    for (let i = 0; i < W / 48 + 2; i++) {
      ctx.fillRect(Math.round(i * 48 - dashOff), groundY + 14, 24, 2);
    }
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────────

  function drawHUD(ctx: CanvasRenderingContext2D, W: number, score: number, celoEarned: number, level: number, speed: number, lives: number, walletAddress: string = '', walletBalance: string = '0', isMinipay: boolean = false) {
    ctx.imageSmoothingEnabled = false;

    // Score
    pixelText(ctx, `${String(score).padStart(6, '0')}`, 14, 26, 9, NINJA_THEME.accentPrimary);

    // Level badge
    const lvlColors = ['#7c3aed', '#a855f7', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#f43f5e', '#22d3ee'];
    const lc = lvlColors[Math.min(level - 1, 7)];
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W / 2 - 28, 6, 56, 22);
    ctx.fillStyle = lc;
    ctx.font = `7px "Press Start 2P", monospace`;
    ctx.fillText(`LVL ${level}`, W / 2 - 20, 22);

    // Wallet info (top right)
    const rightMargin = Math.min(135, W * 0.36);
    if (walletAddress) {
      const walletStr = formatAddress(walletAddress);
      pixelText(ctx, walletStr, W - rightMargin, 12, 6, '#8888ff');
      pixelText(ctx, `${walletBalance} ${isMinipay ? 'USDm' : 'C'}`, W - rightMargin, 24, 6, PAL.coin);
    }

    // CELO top right
    ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
    ctx.shadowBlur = 8;
    pixelText(ctx, `${celoEarned.toFixed(4)}`, W - Math.min(100, rightMargin * 0.75), 36, 7, PAL.coin);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(230, 245, 255, 0.6)';
    ctx.font = `5px "Press Start 2P", monospace`;
    ctx.fillText('CELO', W - Math.min(100, rightMargin * 0.75), 48);

    // Lives — hearts
    for (let i = 0; i < Math.min(lives, 5); i++) {
      ctx.font = '14px sans-serif';
      ctx.shadowColor = 'rgba(255, 90, 109, 0.6)';
      ctx.shadowBlur = 8;
      ctx.fillText('❤️', 14 + i * 18, 46);
    }
    ctx.shadowBlur = 0;
    if (lives > 5) {
      ctx.fillStyle = NINJA_THEME.error;
      ctx.font = `6px "Press Start 2P", monospace`;
      ctx.fillText(`+${lives - 5}`, 14 + 5 * 18, 46);
    }

    // Speed bar
    const speedNorm = Math.min((speed - BASE_SPEED) / (MAX_LEVEL * SPEED_INCREMENT + 2), 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(8, 52, 70, 5);
    ctx.fillStyle = speedNorm > 0.7 ? PAL.red : speedNorm > 0.4 ? PAL.amber : PAL.neon;
    ctx.fillRect(8, 52, Math.round(70 * speedNorm), 5);
  }

  // ─── Level-based obstacle patterns ───────────────────────────────────────────

  function getObstaclePattern(level: number, W: number, groundY: number, score: number): Obstacle[] {
    const patterns: (() => Obstacle[])[] = [];

    // Always available: simple spikes
    patterns.push(() => [{
      x: W + 10, y: groundY - 32, width: 24, height: 32,
      type: 'spike',
    }]);

    // Spike group (level 1+)
    patterns.push(() => [{
      x: W + 10, y: groundY - 32, width: 56, height: 32,
      type: 'spike_group',
    }]);

    // Level 2+: spike wall
    if (level >= 2) {
      patterns.push(() => [{
        x: W + 10, y: groundY - 64, width: 28, height: 64,
        type: 'spike_wall',
      }]);
    }

    // Level 2+: rotating wheel (floating mid-air)
    if (level >= 2) {
      patterns.push(() => [{
        x: W + 10, y: groundY - 120, width: 56, height: 56,
        type: 'rotating_wheel', angle: 0,
      }]);
    }

    // Level 3+: moving spike
    if (level >= 3) {
      patterns.push(() => [{
        x: W + 10,
        y: groundY - 60,
        width: 28, height: 32,
        type: 'moving_spike',
        moveDir: 1,
        moveRange: 80,
        moveOrigin: groundY - 60,
      }]);
    }

    // Level 3+: low ceiling (jump under it)
    if (level >= 3) {
      patterns.push(() => [{
        x: W + 10, y: 0, width: 120, height: groundY - P_SIZE * 2.2,
        type: 'low_ceiling',
      }]);
    }

    // Level 4+: spike then wall combo
    if (level >= 4) {
      patterns.push(() => [
        { x: W + 10, y: groundY - 32, width: 24, height: 32, type: 'spike' as ObstacleType },
        { x: W + 80, y: groundY - 56, width: 28, height: 56, type: 'spike_wall' as ObstacleType },
      ]);
    }

    // Level 4+: platform gap — floating platform above spikes
    if (level >= 4) {
      patterns.push(() => [
        { x: W + 10, y: groundY - 32, width: 84, height: 32, type: 'spike_group' as ObstacleType },
        { x: W + 20, y: groundY - 110, width: 64, height: 14, type: 'platform_gap' as ObstacleType, platform: true },
      ]);
    }

    // Level 5+: wheel + spikes
    if (level >= 5) {
      patterns.push(() => [
        { x: W + 10, y: groundY - 56, width: 56, height: 56, type: 'rotating_wheel' as ObstacleType, angle: 0 },
        { x: W + 100, y: groundY - 32, width: 56, height: 32, type: 'spike_group' as ObstacleType },
      ]);
    }

    // Level 6+: triple spike gauntlet
    if (level >= 6) {
      patterns.push(() => [
        { x: W + 10, y: groundY - 32, width: 24, height: 32, type: 'spike' as ObstacleType },
        { x: W + 60, y: groundY - 32, width: 24, height: 32, type: 'spike' as ObstacleType },
        { x: W + 110, y: groundY - 32, width: 24, height: 32, type: 'spike' as ObstacleType },
      ]);
    }

    // Level 7+: wall + moving spike + ground spikes
    if (level >= 7) {
      patterns.push(() => [
        { x: W + 10, y: groundY - 80, width: 28, height: 80, type: 'spike_wall' as ObstacleType },
        { x: W + 80, y: groundY - 70, width: 28, height: 32, type: 'moving_spike' as ObstacleType, moveDir: -1, moveRange: 60, moveOrigin: groundY - 70 },
        { x: W + 150, y: groundY - 32, width: 24, height: 32, type: 'spike' as ObstacleType },
      ]);
    }

    // Level 8+: everything
    if (level >= 8) {
      patterns.push(() => [
        { x: W + 10, y: groundY - 100, width: 60, height: 60, type: 'rotating_wheel' as ObstacleType, angle: 0 },
        { x: W + 100, y: groundY - 32, width: 56, height: 32, type: 'spike_group' as ObstacleType },
        { x: W + 200, y: groundY - 56, width: 28, height: 56, type: 'spike_wall' as ObstacleType },
      ]);
    }

    const available = patterns;
    return available[Math.floor(Math.random() * available.length)]();
  }

  // ─── Wallet Integration ───────────────────────────────────────────────────────

  // Fetch a wallet's spendable balance, formatted to 4 dp. For MiniPay we read
  // the USDm token balance (balanceOf) — MiniPay users typically hold no native
  // CELO, so eth_getBalance would misleadingly show ~0. Everyone else reads the
  // native CELO balance as before. Both USDm and CELO use 18 decimals.
  async function fetchWalletBalance(address: string, isMinipay: boolean): Promise<string> {
    const body = isMinipay
      ? {
          jsonrpc: '2.0',
          method: 'eth_call',
          // balanceOf(address): selector 0x70a08231 + 32-byte-padded address.
          params: [
            { to: USDM_ADDRESS, data: '0x70a08231' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0') },
            'latest',
          ],
          id: 1,
        }
      : { jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 };

    const hex = await fetch('https://forno.celo.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => d.result || '0x0');

    return (Number(BigInt(hex)) / 1e18).toFixed(4);
  }

  // useWallet hook
  function useWallet() {
    const [wallet, setWallet] = useState({ address: '', balance: '0', isConnected: false, isMinipay: false });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      const connectWallet = async () => {
        try {
          if (!window.ethereum) {
            setIsLoading(false);
            return;
          }

          // MiniPay auto-connects and injects the account, so read it directly
          // with eth_accounts (no prompt). Regular wallets (MetaMask, etc.) keep
          // the existing eth_requestAccounts manual-approval flow — unchanged.
          const isMinipay = window.ethereum.isMiniPay || false;
          const accountsMethod = isMinipay ? 'eth_accounts' : 'eth_requestAccounts';
          const accounts = await window.ethereum.request({ method: accountsMethod });
          if (!accounts || accounts.length === 0) {
            setIsLoading(false);
            return;
          }

          const address = accounts[0];

          // USDm balance for MiniPay, native CELO balance otherwise.
          const balance = await fetchWalletBalance(address, isMinipay);

          setWallet({ address, balance, isConnected: true, isMinipay });
        } catch (error) {
          console.error('Wallet connection error:', error);
        } finally {
          setIsLoading(false);
        }
      };

      connectWallet();
    }, []);

    // Refresh balance every 10 seconds
    useEffect(() => {
      if (!wallet.isConnected) return;
      const interval = setInterval(async () => {
        try {
          const balance = await fetchWalletBalance(wallet.address, wallet.isMinipay);
          setWallet(w => ({ ...w, balance }));
        } catch (error) {
          console.error('Balance refresh error:', error);
        }
      }, 10000);

      return () => clearInterval(interval);
    }, [wallet.address, wallet.isConnected, wallet.isMinipay]);

    return wallet;
  }

  // Send CELO transaction
  async function sendCELO(to: string, amountCelo: number): Promise<string | null> {
    if (!window.ethereum) {
      console.error('Ethereum not available');
      return null;
    }

    try {
      const amountWei = (amountCelo * 1e18).toString();
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: window.ethereum.selectedAddress,
            to,
            value: '0x' + BigInt(amountWei).toString(16),
            chainId: 42220, // Celo Mainnet
          },
        ],
      });
      return txHash;
    } catch (error) {
      console.error('Send CELO error:', error);
      return null;
    }
  }

  // Send USDm (Mento Dollar) — an ERC-20 transfer, used for MiniPay where the
  // user pays in stablecoin rather than native CELO. Instead of a native value
  // transfer, this calls transfer(to, amount) on the USDm token contract:
  //   to    = token contract, value = 0, data = 0xa9059cbb + to + amount
  // USDm uses 18 decimals (same as CELO), so the amount scaling matches.
  async function sendUSDm(to: string, amountUsdm: number): Promise<string | null> {
    if (!window.ethereum) {
      console.error('Ethereum not available');
      return null;
    }

    try {
      const amountWei = BigInt(Math.round(amountUsdm * 1e18));
      // ABI-encode transfer(address,uint256): 4-byte selector + two 32-byte words.
      const selector = 'a9059cbb';
      const toWord = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
      const amountWord = amountWei.toString(16).padStart(64, '0');
      const data = '0x' + selector + toWord + amountWord;

      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: window.ethereum.selectedAddress,
            to: USDM_ADDRESS,     // call the token contract, not the recipient
            value: '0x0',         // no native value moves in an ERC-20 transfer
            data,
            chainId: 42220, // Celo Mainnet
          },
        ],
      });
      return txHash;
    } catch (error) {
      console.error('Send USDm error:', error);
      return null;
    }
  }

  // Format address: 0x1234...5678
  function formatAddress(addr: string): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  // ─── Main Component ───────────────────────────────────────────────────────────

  export default function Game() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef<GameState>({
      isRunning: false, isOver: false,
      score: 0, highScore: 0,
      speed: BASE_SPEED, distance: 0,
      celoEarned: 0, totalCeloEarned: 0,
      level: 1, lastSpeedUp: 0, lives: 1,
    });

    const playerRef = useRef({
      x: 80, y: 0, vy: 0,
      isJumping: false, jumpCount: 0,
      animFrame: 0, isDead: false,
    });

    const obstaclesRef = useRef<Obstacle[]>([]);
    const coinsRef = useRef<Coin[]>([]);
    const particlesRef = useRef<Particle[]>([]);
    const bgOffsetRef = useRef(0);
    const lastObsRef = useRef(0);
    const nextCoinRef = useRef(0);      // timestamp when next coin should spawn
    const rafRef = useRef<number>(0);
    const lastTimeRef = useRef(0);
    const gameStartRef = useRef(0);
    const shakeRef = useRef({ x: 0, y: 0, timer: 0 });
    const flashRef = useRef({ text: '', timer: 0, color: PAL.neon });
    const sessionTokenRef = useRef<string | null>(null); // signed reward-session token

    const [uiScore, setUiScore] = useState(0);
    const [uiHighScore, setUiHighScore] = useState(0);
    const [uiCelo, setUiCelo] = useState(0);
    const [uiTotalCelo, setUiTotalCelo] = useState(0);
    const [gamePhase, setGamePhase] = useState<'idle' | 'playing' | 'over'>('idle');
    const [flashMsg, setFlashMsg] = useState('');
    const [uiLives, setUiLives] = useState(1);
    const [showBuyLives, setShowBuyLives] = useState(false);
    const [walletData, setWalletData] = useState({ address: '', balance: '0', isConnected: false, isMinipay: false });
    const [isProcessingBuy, setIsProcessingBuy] = useState(false);
    const [onChainStatus, setOnChainStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'declined' | 'no-gas'>('idle');
    const [onChainTx, setOnChainTx] = useState('');
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [topScores, setTopScores] = useState<TopScore[]>([]);
    const [lbLoading, setLbLoading] = useState(false);

    const wallet = useWallet();

    // Request a signed, short-lived reward-session token whenever a run starts
    // with a connected wallet. /api/reward requires this token, so payouts are
    // bound to the wallet + capped per session server-side.
    useEffect(() => {
      if (gamePhase !== 'playing' || !walletData.isConnected || !walletData.address) return;
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch('/api/game-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: walletData.address }),
          });
          const data = await res.json().catch(() => ({ success: false }));
          if (!cancelled && res.ok && data.success && data.token) {
            sessionTokenRef.current = data.token;
          }
        } catch (err) {
          console.error('Session token request error:', err);
        }
      })();
      return () => { cancelled = true; };
    }, [gamePhase, walletData.isConnected, walletData.address]);

    const openLeaderboard = useCallback(async () => {
      setShowLeaderboard(true);
      setLbLoading(true);
      try {
        const scores = await fetchTopScores();
        setTopScores(scores.slice(0, 5));
      } catch {
        setTopScores([]);
      } finally {
        setLbLoading(false);
      }
    }, []);

    // Record a finished run on the CheetahChain leaderboard (real Celo tx).
    const saveScoreOnChain = useCallback(async (score: number) => {
      if (!window.ethereum || score <= 0) return;
      setOnChainStatus('saving');
      setOnChainTx('');
      const result = await submitScoreOnChain(score);
      if (result.status === 'saved' && result.txHash) {
        setOnChainStatus('saved');
        setOnChainTx(result.txHash);
      } else if (result.status === 'declined') {
        setOnChainStatus('declined');
      } else if (result.status === 'no-gas') {
        setOnChainStatus('no-gas');
      } else {
        setOnChainStatus('error');
      }
    }, []);

    useEffect(() => {
      setWalletData(wallet);
    }, [wallet]);

    useEffect(() => {
      const hs = parseInt(localStorage.getItem('gd_hs') || '0', 10);
      const tc = parseFloat(localStorage.getItem('gd_celo') || '0');
      stateRef.current.highScore = hs;
      stateRef.current.totalCeloEarned = tc;
      setUiHighScore(hs);
      setUiTotalCelo(tc);
    }, []);

    const spawnParticles = useCallback((x: number, y: number, colors: string[]) => {
      for (let i = 0; i < 20; i++) {
        particlesRef.current.push({
          x, y,
          vx: (Math.random() - 0.5) * 10,
          vy: -Math.random() * 8 - 2,
          life: 1,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 4 + Math.random() * 6,
        });
      }
    }, []);

    const startGame = useCallback((extraLives = 0) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const groundY = canvas.height * GROUND_RATIO;
      const now = performance.now();
      stateRef.current = {
        isRunning: true, isOver: false,
        score: 0, highScore: stateRef.current.highScore,
        speed: BASE_SPEED, distance: 0,
        celoEarned: 0, totalCeloEarned: stateRef.current.totalCeloEarned,
        level: 1, lastSpeedUp: now,
        lives: 1 + extraLives,
      };
      playerRef.current = {
        x: 80, y: groundY - P_SIZE,
        vy: 0, isJumping: false, jumpCount: 0,
        animFrame: 0, isDead: false,
      };
      obstaclesRef.current = [];
      coinsRef.current = [];
      particlesRef.current = [];
      lastObsRef.current = now;
      gameStartRef.current = now;
      nextCoinRef.current = now + FIRST_COIN_MS;
      flashRef.current = { text: '', timer: 0, color: PAL.neon };
      setGamePhase('playing');
      setUiScore(0);
      setUiCelo(0);
      setFlashMsg('');
      setUiLives(1 + extraLives);
      setShowBuyLives(false);
      setOnChainStatus('idle');
      setOnChainTx('');
      setShowLeaderboard(false);
    }, []);

    const endGame = useCallback((fromLife = false) => {
      const state = stateRef.current;
      const p = playerRef.current;

      if (!fromLife) {
        state.isRunning = false;
        state.isOver = true;
        p.isDead = true;
      }
      shakeRef.current = { x: 0, y: 0, timer: 500 };

      if (state.score > state.highScore) {
        state.highScore = state.score;
        localStorage.setItem('gd_hs', String(state.score));
        setUiHighScore(state.score);
      }
      if (!fromLife) {
        const newTotal = state.totalCeloEarned + state.celoEarned;
        state.totalCeloEarned = newTotal;
        localStorage.setItem('gd_celo', String(newTotal));
      }

      spawnParticles(p.x + P_SIZE / 2, p.y + P_SIZE / 2, [PAL.red, PAL.amber, '#fff', PAL.player]);

      if (!fromLife) {
        setGamePhase('over');
        // Record this run on-chain (fire-and-forget; updates the status badge).
        if (state.score > 0) saveScoreOnChain(state.score);
      }
    }, [spawnParticles, saveScoreOnChain]);

    const jump = useCallback(() => {
      const p = playerRef.current;
      const state = stateRef.current;
      if (!state.isRunning) return;
      if (p.jumpCount < 2) {
        p.vy = p.jumpCount === 0 ? JUMP_FORCE : JUMP2_FORCE;
        p.isJumping = true;
        p.jumpCount += 1;
        if (p.jumpCount === 2) {
          flashRef.current = { text: 'DOUBLE!', timer: 500, color: PAL.blue };
        }
      }
    }, []);

    // Buy lives
    const buyLives = useCallback(async () => {
      if (!walletData.isConnected || !walletData.address) {
        alert('Please connect your wallet first');
        return;
      }

      setIsProcessingBuy(true);
      try {
        // MiniPay users pay in USDm (ERC-20); everyone else pays in native CELO.
        const RECEIVER = '0x54CfcB5DA23dB98762C3919093A9B230D6Ed429D';
        const txHash = walletData.isMinipay
          ? await sendUSDm(RECEIVER, LIVES_COST_USDM)
          : await sendCELO(RECEIVER, LIVES_COST_CELO);
        if (!txHash) {
          alert('Transaction failed');
          return;
        }

        // Never trust the wallet's word that the payment succeeded. The backend
        // confirms this is a real, mined payment (0.1 CELO, or the USDm equivalent
        // for MiniPay) to the correct address, sent by this wallet, and not already
        // redeemed — BEFORE granting lives. It auto-detects the asset from the tx.
        const res = await fetch('/api/verify-lives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash, from: walletData.address }),
        });
        const data = await res.json().catch(() => ({ success: false }));
        if (!res.ok || !data.success) {
          alert(data.error || 'Payment could not be verified — lives not granted');
          return;
        }

        // Verified on-chain — add 10 lives and resume.
        const state = stateRef.current;
        state.lives += EXTRA_LIVES;
        setUiLives(state.lives);
        setShowBuyLives(false);
        // Resume game
        state.isOver = false;
        state.isRunning = true;
        playerRef.current.isDead = false;
        const canvas = canvasRef.current;
        if (canvas) {
          const groundY = canvas.height * GROUND_RATIO;
          playerRef.current.y = groundY - P_SIZE;
          playerRef.current.vy = 0;
        }
        obstaclesRef.current = [];
        setGamePhase('playing');
        flashRef.current = { text: '✨ +10 LIVES!', timer: 1200, color: PAL.neon };
      } catch (error) {
        console.error('Buy lives error:', error);
        alert('Error purchasing lives');
      } finally {
        setIsProcessingBuy(false);
      }
    }, [walletData.isConnected, walletData.address, walletData.isMinipay]);

    // Main loop
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resize = () => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      };
      resize();
      window.addEventListener('resize', resize);

      let scoreInterval: ReturnType<typeof setInterval>;

      const loop = (timestamp: number) => {
        const dt = Math.min(timestamp - lastTimeRef.current, 50);
        lastTimeRef.current = timestamp;

        const W = canvas.width;
        const H = canvas.height;
        const groundY = H * GROUND_RATIO;

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, W, H);

        const state = stateRef.current;
        const p = playerRef.current;

        // ── Speed up every 10s ──
        if (state.isRunning) {
          const elapsed = timestamp - state.lastSpeedUp;
          if (elapsed > SPEEDUP_INTERVAL) {
            state.speed += SPEED_INCREMENT;
            state.lastSpeedUp = timestamp;
            state.level = Math.min(state.level + 1, MAX_LEVEL);
            const lc = ['#7c3aed', '#a855f7', '#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#f43f5e', '#22d3ee'];
            flashRef.current = { text: `⚡ LVL ${state.level}!`, timer: 1400, color: lc[Math.min(state.level - 1, 7)] };
            setFlashMsg(`LVL ${state.level}`);
            setTimeout(() => setFlashMsg(''), 1400);
          }
          state.distance += state.speed;

          // Coin spawn
          if (timestamp >= nextCoinRef.current) {
            const heights = [groundY - 70, groundY - 110, groundY - 150];
            coinsRef.current.push({
              x: W + 20,
              y: heights[Math.floor(Math.random() * heights.length)],
              size: 26,
              collected: false,
              bobOffset: Math.random() * Math.PI * 2,
            });
            nextCoinRef.current = timestamp + COIN_INTERVAL_MS;
          }
        }

        if (state.isRunning) bgOffsetRef.current += state.speed;

        // Screen shake
        const sh = shakeRef.current;
        if (sh.timer > 0) {
          sh.timer -= dt;
          sh.x = (Math.random() - 0.5) * 10;
          sh.y = (Math.random() - 0.5) * 10;
        } else { sh.x = 0; sh.y = 0; }

        // Background
        drawBackground(ctx, W, H, groundY, bgOffsetRef.current, state.level);

        // ── Spawn obstacles ──
        if (state.isRunning) {
          const minGap = Math.max(350, 1400 - state.level * 80);
          if (timestamp - lastObsRef.current > minGap) {
            const newObs = getSpawnedObstacles(state.level, W, groundY, state.score);
            obstaclesRef.current.push(...newObs);
            lastObsRef.current = timestamp;
          }
        }

        // ── Update & draw obstacles ──
        obstaclesRef.current = obstaclesRef.current.filter(obs => {
          if (state.isRunning) {
            obs.x -= state.speed;
            // Rotate wheels
            if (obs.kind === 'rotating_wheel') {
              obs.angle = (obs.angle || 0) + 0.05 + state.speed * 0.005;
            }
            // Move moving spikes
            if (obs.kind === 'moving_spike' && obs.moveDir !== undefined) {
              obs.y += obs.moveDir * 2;
              const origin = obs.moveOrigin ?? obs.y;
              const range = obs.moveRange ?? 60;
              if (obs.y < origin - range || obs.y > origin) obs.moveDir *= -1;
            }
          }

          drawObstacle(ctx, obs, timestamp);

          // Collision (not for platforms — those are safe to land on)
          if (state.isRunning && !p.isDead && !obs.platform) {
            const margin = 5;
            if (
              p.x + margin < obs.x + obs.width &&
              p.x + P_SIZE - margin > obs.x &&
              p.y + margin < obs.y + obs.height &&
              p.y + P_SIZE - margin > obs.y
            ) {
              // Use a life
              if (state.lives > 1) {
                state.lives -= 1;
                setUiLives(state.lives);
                shakeRef.current = { x: 0, y: 0, timer: 400 };
                spawnParticles(p.x + P_SIZE / 2, p.y, [PAL.red, PAL.amber]);
                obstaclesRef.current = [];
              } else {
                endGame();
              }
            }
          }

          // Platform — land on top
          if (obs.platform && state.isRunning) {
            if (
              p.x + P_SIZE > obs.x + 4 &&
              p.x < obs.x + obs.width - 4 &&
              p.y + P_SIZE >= obs.y &&
              p.y + P_SIZE <= obs.y + obs.height + Math.abs(p.vy) + 4 &&
              p.vy >= 0
            ) {
              p.y = obs.y - P_SIZE;
              p.vy = 0;
              p.isJumping = false;
              p.jumpCount = 0;
            }
          }

          return obs.x > -obs.width - 60;
        });

        // ── Coins ──
        coinsRef.current = coinsRef.current.filter(coin => {
          if (state.isRunning && !coin.collected) coin.x -= state.speed;
          drawCoin(ctx, coin, timestamp);

          if (state.isRunning && !coin.collected) {
            if (
              p.x + P_SIZE > coin.x && p.x < coin.x + coin.size &&
              p.y + P_SIZE > coin.y && p.y < coin.y + coin.size
            ) {
              coin.collected = true;
              state.celoEarned += CELO_PER_COIN;
              setUiCelo(state.celoEarned);
              flashRef.current = { text: `+${CELO_PER_COIN} CELO!`, timer: 900, color: PAL.coin };
              spawnParticles(coin.x + coin.size / 2, coin.y, [PAL.coin, '#fff', PAL.coinShd]);

              // Send reward to player wallet
              if (walletData.isConnected && walletData.address) {
                fetch('/api/reward', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to: walletData.address,
                    amount: '0.002',
                    token: sessionTokenRef.current,
                    // MiniPay players are paid in USDm; the server enforces the
                    // amount and only uses this flag to pick the payout currency.
                    isMiniPay: walletData.isMinipay,
                  }),
                }).catch(err => console.error('Reward request error:', err));
              }
            }
          }
          return coin.x > -60 && !coin.collected;
        });

        // ── Player physics ──
        if (!state.isOver) {
          p.vy += GRAVITY;
          p.y += p.vy;
          if (p.y >= groundY - P_SIZE) {
            p.y = groundY - P_SIZE;
            p.vy = 0;
            p.isJumping = false;
            p.jumpCount = 0;
          }
          if (state.isRunning) p.animFrame += dt * 0.06;
        }

        // Draw player
        drawPlayer(ctx, p.x, p.y, p.animFrame, p.isDead, p.jumpCount, sh.x, sh.y);

        // ── Particles ──
        particlesRef.current = particlesRef.current.filter(pt => {
          pt.x += pt.vx;
          pt.vy += 0.3;
          pt.y += pt.vy;
          pt.life -= 0.025;
          ctx.globalAlpha = Math.max(0, pt.life);
          px(ctx, pt.x, pt.y, pt.size * pt.life, pt.size * pt.life, pt.color);
          ctx.globalAlpha = 1;
          return pt.life > 0;
        });

        // ── Flash message ──
        if (flashRef.current.timer > 0) {
          flashRef.current.timer -= dt;
          const alpha = Math.min(1, flashRef.current.timer / 300);
          ctx.globalAlpha = alpha;
          ctx.font = `12px "Press Start 2P", monospace`;
          ctx.shadowColor = flashRef.current.color;
          ctx.shadowBlur = 16;
          ctx.fillStyle = flashRef.current.color;
          const tw = ctx.measureText(flashRef.current.text).width;
          ctx.fillText(flashRef.current.text, W / 2 - tw / 2, groundY * 0.38);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }

        // ── HUD ──
        drawHUD(ctx, W, state.score, state.celoEarned, state.level, state.speed, state.lives, walletData.address, walletData.balance, walletData.isMinipay);

        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);

      scoreInterval = setInterval(() => {
        if (stateRef.current.isRunning) {
          stateRef.current.score += 1;
          setUiScore(s => s + 1);
        }
      }, 100);

      return () => {
        cancelAnimationFrame(rafRef.current);
        clearInterval(scoreInterval);
        window.removeEventListener('resize', resize);
      };
    }, [spawnParticles, endGame, walletData]);

    // Keyboard
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
        if (e.code === 'Enter' && gamePhase === 'idle') startGame();
        if (e.code === 'Enter' && gamePhase === 'over') startGame();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [jump, startGame, gamePhase]);

    // ─── Styles ────────────────────────────────────────────────────────────────

    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        background: '#000',
        overflow: 'hidden',
        imageRendering: 'pixelated',
        fontFamily: '"Press Start 2P", monospace',
        touchAction: 'none',
      }}>
        <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(12px) scale(0.95); } to { opacity:1; transform:none; } }
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes shake   { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 60%{transform:translateX(8px)} }
        @keyframes pop     { 0%{transform:scale(0.5)} 60%{transform:scale(1.15)} 100%{transform:scale(1)} }
        @keyframes glow    { 0%,100%{text-shadow:0 0 8px #39c3ff} 50%{text-shadow:0 0 24px #39c3ff, 0 0 40px #39c3ff} }
        @keyframes floatBlob1 {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(15%, 10%) scale(1.1); }
          100% { transform: translate(-5%, 15%) scale(0.9); }
        }
        @keyframes floatBlob2 {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-10%, -15%) scale(0.95); }
          100% { transform: translate(10%, -5%) scale(1.05); }
        }
        canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }

        .start-card-container {
          background: rgba(11, 23, 50, 0.9);
          border: 1.5px solid ${NINJA_THEME.accentPrimary};
          border-radius: ${BORDER_RADIUS.container};
          box-shadow: ${SHADOWS.glowMediumBlue};
          backdrop-filter: blur(8px);
          padding: 28px 24px;
          text-align: center;
          max-width: 320px;
          width: 92%;
          position: relative;
          z-index: 5;
          transition: all 0.2s ease;
        }
        .start-card-title {
          background: linear-gradient(135deg, ${NINJA_THEME.accentPrimary}, ${NINJA_THEME.accentSecondary});
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          font-size: 20px;
          font-family: ${FONT_FAMILY.display};
          text-shadow: 0 0 20px rgba(57, 195, 255, 0.4);
          animation: glow 2s infinite;
          margin-bottom: 2px;
          line-height: 1.4;
        }
        .start-card-btn-start {
          background: ${GRADIENTS.accentBlue};
          color: ${NINJA_THEME.bg};
          border: 1.5px solid rgba(255, 255, 255, 0.25);
          border-radius: ${BORDER_RADIUS.button};
          box-shadow: ${SHADOWS.glowMediumBlue};
          font-family: "Press Start 2P", monospace;
          font-size: 11px;
          padding: 14px 28px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.2s ease;
          display: block;
          width: 100%;
          font-weight: bold;
          text-align: center;
          min-height: 46px;
        }
        .start-card-btn-leaderboard {
          background: transparent;
          color: ${NINJA_THEME.accentPrimary};
          border: 1.5px solid ${NINJA_THEME.accentPrimary};
          border-radius: ${BORDER_RADIUS.button};
          box-shadow: none;
          font-family: "Press Start 2P", monospace;
          font-size: 10px;
          padding: 12px 24px;
          cursor: pointer;
          letter-spacing: 0.5px;
          transition: all 0.2s ease;
          display: block;
          width: 100%;
          font-weight: bold;
          text-align: center;
          min-height: 44px;
        }
        @media (hover: hover) {
          .start-card-btn-start:hover {
            transform: translateY(-2px);
            box-shadow: ${SHADOWS.glowStrongBlue};
            background: ${GRADIENTS.accentBlueReverse};
          }
          .start-card-btn-leaderboard:hover {
            transform: translateY(-2px);
            box-shadow: ${SHADOWS.glowMediumBlue};
            background: rgba(57, 195, 255, 0.15);
          }
        }
        .start-card-btn-start:active {
          transform: translateY(1px) !important;
          box-shadow: 0 0 12px rgba(57, 195, 255, 0.2) !important;
          background: ${GRADIENTS.accentBlueReverse} !important;
        }
        .start-card-btn-leaderboard:active {
          transform: translateY(1px) !important;
          box-shadow: 0 0 12px rgba(57, 195, 255, 0.2) !important;
          background: rgba(57, 195, 255, 0.15) !important;
        }
        @media (max-width: 480px) {
          .start-card-container {
            padding: clamp(16px, 5vh, 24px) clamp(12px, 4vw, 20px);
          }
          .start-card-title {
            font-size: clamp(15px, 5.2vw, 18px);
          }
          .start-card-btn-start {
            padding: 15px 20px;
            font-size: 10px;
            min-height: 44px;
          }
          .start-card-btn-leaderboard {
            padding: 14px 20px;
            font-size: 9px;
            min-height: 44px;
          }
        }
      `}</style>

        {/* Canvas — full viewport */}
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

        {/* ── IDLE SCREEN ── */}
        {gamePhase === 'idle' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${NINJA_THEME.bg}, ${NINJA_THEME.bgSecondary})`,
            animation: 'fadeIn 0.3s ease',
            overflow: 'hidden',
          }}>
            {/* Ambient Background Blobs */}
            <div style={{
              position: 'absolute',
              top: '-15%', left: '-15%',
              width: '60%', height: '60%',
              background: `radial-gradient(circle, ${NINJA_THEME.accentPrimary}1A 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(50px)',
              pointerEvents: 'none',
              animation: 'floatBlob1 20s ease-in-out infinite alternate',
              zIndex: 1,
            }} />
            <div style={{
              position: 'absolute',
              bottom: '-15%', right: '-15%',
              width: '60%', height: '60%',
              background: `radial-gradient(circle, ${NINJA_THEME.accentSecondary}1A 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(50px)',
              pointerEvents: 'none',
              animation: 'floatBlob2 25s ease-in-out infinite alternate',
              zIndex: 1,
            }} />

            <div className="start-card-container">
              {/* Logo / Icon Accent */}
              <svg
                viewBox="0 0 100 100"
                width="32"
                height="32"
                fillRule="evenodd"
                style={{
                  fill: NINJA_THEME.accentPrimary,
                  filter: `drop-shadow(0 0 8px ${NINJA_THEME.accentPrimary}88)`,
                  display: 'block',
                  margin: `0 auto ${SPACING.sm}`,
                  animation: 'spin 12s linear infinite',
                }}
              >
                <path d="M 50 10 C 50 35 65 35 90 50 C 65 50 65 65 50 90 C 50 65 35 65 10 50 C 35 50 35 35 50 10 Z M 50 42 A 8 8 0 1 0 50 58 A 8 8 0 1 0 50 42 Z" />
              </svg>

              {/* Title */}
              <div className="start-card-title">ENDLESS RUN</div>
              <div style={{
                color: PAL.coin, fontSize: 7,
                fontFamily: '"Press Start 2P", monospace',
                letterSpacing: 3, marginBottom: 20,
              }}>× CELO EDITION ×</div>

              <div style={{ fontSize: 44, marginBottom: 18 }}>🐆</div>

              {/* Controls */}
              <div style={{
                background: 'rgba(11, 23, 50, 0.5)',
                border: '1px solid rgba(57, 195, 255, 0.25)',
                borderRadius: BORDER_RADIUS.button,
                padding: `${SPACING.sm} ${SPACING.md}`,
                marginBottom: SPACING.md,
                textAlign: 'left',
              }}>
                {[
                  ['TAP / SPACE', 'JUMP'],
                  ['TAP AGAIN', 'DOUBLE JUMP'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: SPACING.xs }}>
                    <span style={{ color: 'rgba(230, 245, 255, 0.8)', fontSize: 7, fontFamily: '"Press Start 2P", monospace' }}>{k}</span>
                    <span style={{ color: 'rgba(230, 245, 255, 0.4)', fontSize: 7, fontFamily: '"Press Start 2P", monospace' }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Earn info */}
              <div style={{
                background: '#0a0f00', border: `2px solid ${PAL.coin}`,
                padding: '10px', marginBottom: 20,
              }}>
                <div style={{ color: PAL.coin, fontSize: 7, fontFamily: '"Press Start 2P", monospace', lineHeight: 2.2 }}>
                  🪙 COIN EVERY 30 SEC<br />
                  <span style={{ color: PAL.neon }}>= +{CELO_PER_COIN} CELO EACH</span><br />
                  <span style={{ color: '#888' }}>FIRST COIN @ 5 SEC</span>
                </div>
              </div>

              {uiTotalCelo > 0 && (
                <div style={{ color: PAL.coin, fontSize: 7, fontFamily: '"Press Start 2P", monospace', marginBottom: 14 }}>
                  LIFETIME: {uiTotalCelo.toFixed(4)} CELO
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
                <button
                  onClick={() => startGame()}
                  className="start-card-btn-start"
                >
                  ▶ START
                </button>

                <button
                  onClick={openLeaderboard}
                  className="start-card-btn-leaderboard"
                >
                  🏆 LEADERBOARD
                </button>
              </div>

              <div style={{ color: 'rgba(230, 245, 255, 0.35)', fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginTop: SPACING.md }}>
                PRESS ENTER TO START
              </div>
            </div>
          </div>
        )}

        {/* ── GAME OVER SCREEN — Subway Surfers style with buy lives ── */}
        {gamePhase === 'over' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${NINJA_THEME.bg}, ${NINJA_THEME.bgSecondary})`,
            animation: 'fadeIn 0.35s ease',
            overflow: 'hidden',
          }}>
            {/* Ambient Background Blobs */}
            <div style={{
              position: 'absolute',
              top: '-15%', left: '-15%',
              width: '60%', height: '60%',
              background: `radial-gradient(circle, ${NINJA_THEME.error}1F 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(50px)',
              pointerEvents: 'none',
              animation: 'floatBlob1 20s ease-in-out infinite alternate',
              zIndex: 1,
            }} />
            <div style={{
              position: 'absolute',
              bottom: '-15%', right: '-15%',
              width: '60%', height: '60%',
              background: `radial-gradient(circle, ${NINJA_THEME.accentPrimary}1F 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(50px)',
              pointerEvents: 'none',
              animation: 'floatBlob2 25s ease-in-out infinite alternate',
              zIndex: 1,
            }} />
            <div style={{
              position: 'absolute',
              top: '40%', left: '30%',
              width: '40%', height: '40%',
              background: `radial-gradient(circle, ${NINJA_THEME.accentSecondary}12 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(60px)',
              pointerEvents: 'none',
              animation: 'floatBlob1 18s ease-in-out infinite alternate-reverse',
              zIndex: 1,
            }} />
            <div style={{
              background: 'rgba(11, 23, 50, 0.9)',
              border: `1.5px solid ${NINJA_THEME.error}`,
              borderRadius: BORDER_RADIUS.container,
              boxShadow: SHADOWS.glowStrongError,
              backdropFilter: 'blur(8px)',
              padding: '24px 20px',
              textAlign: 'center',
              maxWidth: 320,
              width: '92%',
              position: 'relative',
              zIndex: 5,
              animation: 'shake 0.5s ease',
            }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>💥</div>
              <div style={{
                background: GRADIENTS.errorGradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontSize: 22,
                fontFamily: FONT_FAMILY.display,
                filter: 'drop-shadow(0 0 16px rgba(255, 90, 109, 0.5))',
                marginBottom: 4,
                lineHeight: 1.4,
                letterSpacing: 1,
              }}>GAME OVER</div>
              <div style={{ color: 'rgba(230, 245, 255, 0.4)', fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginBottom: SPACING.md, letterSpacing: 2 }}>
                THE CHEETAH HAS FALLEN
              </div>

              {/* Scores */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 14 }}>
                {/* Score Card */}
                <div style={{
                  background: 'rgba(11, 23, 50, 0.6)',
                  border: `1.5px solid ${NINJA_THEME.accentPrimary}`,
                  borderRadius: BORDER_RADIUS.card,
                  boxShadow: SHADOWS.glowSoftBlue,
                  padding: '10px 12px',
                  flex: 1,
                  textAlign: 'center',
                }}>
                  <div style={{ color: NINJA_THEME.accentPrimary, fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginBottom: 6, letterSpacing: 0.5 }}>SCORE</div>
                  <div style={{ color: NINJA_THEME.text, fontSize: 13, fontFamily: '"Press Start 2P", monospace', textShadow: `0 0 10px ${NINJA_THEME.accentPrimary}` }}>{String(uiScore).padStart(6, '0')}</div>
                </div>

                {/* Best Score Card */}
                <div style={{
                  background: 'rgba(11, 23, 50, 0.6)',
                  border: `1.5px solid ${PAL.amber}`,
                  borderRadius: BORDER_RADIUS.card,
                  boxShadow: '0 0 16px rgba(245, 158, 11, 0.15)',
                  padding: '10px 12px',
                  flex: 1,
                  textAlign: 'center',
                }}>
                  <div style={{ color: PAL.amber, fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginBottom: 6, letterSpacing: 0.5 }}>BEST</div>
                  <div style={{ color: NINJA_THEME.text, fontSize: 13, fontFamily: '"Press Start 2P", monospace', textShadow: `0 0 10px ${PAL.amber}` }}>{String(uiHighScore).padStart(6, '0')}</div>
                </div>
              </div>

              {/* CELO earned */}
              <div style={{
                background: 'rgba(11, 23, 50, 0.6)',
                border: `1.5px solid ${PAL.coin}`,
                borderRadius: BORDER_RADIUS.card,
                boxShadow: '0 0 16px rgba(251, 191, 36, 0.15)',
                padding: '12px 14px',
                marginBottom: 16,
              }}>
                <div style={{ color: PAL.coin, fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginBottom: 6, letterSpacing: 0.5 }}>🪙 CELO EARNED</div>
                <div style={{
                  color: NINJA_THEME.text, fontSize: 16,
                  fontFamily: '"Press Start 2P", monospace',
                  textShadow: `0 0 12px ${PAL.coin}`,
                  animation: 'pop 0.4s ease',
                }}>{uiCelo.toFixed(4)}</div>
                <div style={{ color: 'rgba(230, 245, 255, 0.4)', fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginTop: 6 }}>
                  LIFETIME: {uiTotalCelo.toFixed(4)} CELO
                </div>
              </div>

              {uiScore > 0 && uiScore >= uiHighScore && (
                <div style={{
                  color: PAL.amber, fontSize: 8,
                  fontFamily: '"Press Start 2P", monospace',
                  animation: 'blink 0.7s infinite',
                  textShadow: `0 0 8px ${PAL.amber}`,
                  marginBottom: 14,
                }}>★ NEW BEST! ★</div>
              )}

              {/* On-chain leaderboard status */}
              {onChainStatus !== 'idle' && (
                <div style={{
                  background: 'rgba(11, 23, 50, 0.6)',
                  border: `1.5px solid ${onChainStatus === 'saved' ? NINJA_THEME.success : NINJA_THEME.error}`,
                  borderRadius: BORDER_RADIUS.card,
                  boxShadow: onChainStatus === 'saved' ? SHADOWS.glowMediumSuccess : SHADOWS.glowStrongError,
                  padding: '10px 14px',
                  marginBottom: 16,
                }}>
                  <div style={{
                    color: onChainStatus === 'saved' ? NINJA_THEME.success : NINJA_THEME.error,
                    fontSize: 6, fontFamily: '"Press Start 2P", monospace', lineHeight: 1.8,
                    letterSpacing: 0.5,
                  }}>
                    {onChainStatus === 'saving' && '⛓ SAVING RUN ON-CHAIN...'}
                    {onChainStatus === 'saved' && '⛓ SAVED ON CELO ✓'}
                    {onChainStatus === 'declined' && '⛓ DECLINED BY WALLET'}
                    {onChainStatus === 'no-gas' && '⛓ NO CELO FOR GAS'}
                    {onChainStatus === 'error' && '⛓ NOT SAVED'}
                  </div>
                  {onChainStatus === 'saved' && onChainTx && (
                    <a
                      href={`https://celoscan.io/tx/${onChainTx}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: NINJA_THEME.accentPrimary, fontSize: 6, fontFamily: '"Press Start 2P", monospace', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}
                    >
                      VIEW ON CELOSCAN ↗
                    </a>
                  )}
                </div>
              )}

              {/* ── BUY LIVES — Subway Surfers style ── */}
              <div style={{
                background: 'rgba(11, 23, 50, 0.6)',
                border: `1.5px solid ${walletData.isConnected ? NINJA_THEME.accentSecondary : 'rgba(57, 195, 255, 0.2)'}`,
                borderRadius: BORDER_RADIUS.card,
                boxShadow: walletData.isConnected ? '0 0 16px rgba(168, 85, 247, 0.25)' : 'none',
                padding: '14px',
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 24, marginBottom: 6, filter: 'drop-shadow(0 0 8px rgba(255, 90, 109, 0.5))' }}>❤️</div>
                <div style={{
                  color: walletData.isConnected ? NINJA_THEME.accentSecondary : 'rgba(230, 245, 255, 0.5)',
                  fontSize: 8,
                  fontFamily: '"Press Start 2P", monospace',
                  marginBottom: 6,
                  letterSpacing: 0.5,
                }}>CONTINUE?</div>
                <div style={{ color: 'rgba(230, 245, 255, 0.7)', fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginBottom: 12, lineHeight: 2 }}>
                  GET {EXTRA_LIVES} LIVES<br />
                  <span style={{ color: PAL.coin, textShadow: `0 0 8px ${PAL.coin}` }}>
                    COSTS {walletData.isMinipay ? `${LIVES_COST_USDM} USDm` : `${LIVES_COST_CELO} CELO`}
                  </span>
                </div>
                {/* MiniPay connects implicitly — never show a connect prompt there. */}
                {!walletData.isConnected && !walletData.isMinipay ? (
                  <div style={{ color: '#888', fontSize: 5, fontFamily: '"Press Start 2P", monospace' }}>
                    CONNECT WALLET TO CONTINUE
                  </div>
                ) : (
                  <button
                    onClick={buyLives}
                    disabled={isProcessingBuy}
                    style={{
                      background: GRADIENTS.accentBlue,
                      color: NINJA_THEME.bg,
                      border: '1.5px solid rgba(255, 255, 255, 0.25)',
                      borderRadius: BORDER_RADIUS.button,
                      boxShadow: SHADOWS.glowMediumBlue,
                      fontFamily: '"Press Start 2P", monospace',
                      fontSize: 10,
                      padding: '12px 18px',
                      minHeight: 44,
                      width: '100%',
                      opacity: isProcessingBuy ? 0.6 : 1,
                      cursor: isProcessingBuy ? 'not-allowed' : 'pointer',
                      letterSpacing: 0.5,
                      transition: 'all 0.2s ease',
                      fontWeight: 'bold',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onMouseEnter={e => {
                      if (!isProcessingBuy) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = SHADOWS.glowStrongBlue;
                        e.currentTarget.style.background = GRADIENTS.accentBlueReverse;
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isProcessingBuy) {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                        e.currentTarget.style.background = GRADIENTS.accentBlue;
                      }
                    }}
                    onTouchStart={e => {
                      if (!isProcessingBuy) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = SHADOWS.glowStrongBlue;
                        e.currentTarget.style.background = GRADIENTS.accentBlueReverse;
                      }
                    }}
                    onTouchEnd={e => {
                      if (!isProcessingBuy) {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                        e.currentTarget.style.background = GRADIENTS.accentBlue;
                      }
                    }}>
                    {isProcessingBuy ? '⏳ PROCESSING...' : '💎 BUY LIVES'}
                  </button>
                )}
              </div>

              <button
                onClick={openLeaderboard}
                style={{
                  background: 'transparent',
                  color: NINJA_THEME.accentPrimary,
                  border: `1.5px solid ${NINJA_THEME.accentPrimary}`,
                  borderRadius: BORDER_RADIUS.button,
                  boxShadow: 'none',
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 10,
                  padding: '12px 24px',
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                  transition: 'all 0.2s ease',
                  display: 'inline-block',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  width: '100%',
                  marginBottom: 12,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                  e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.background = 'transparent';
                }}
                onTouchStart={e => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                  e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                }}
                onTouchEnd={e => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.background = 'transparent';
                }}>
                🏆 LEADERBOARD
              </button>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button
                  onClick={() => startGame()}
                  style={{
                    background: GRADIENTS.accentBlue,
                    color: NINJA_THEME.bg,
                    border: '1.5px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: BORDER_RADIUS.button,
                    boxShadow: SHADOWS.glowMediumBlue,
                    fontFamily: '"Press Start 2P", monospace',
                    fontSize: 11,
                    padding: '12px 18px',
                    minHeight: 44,
                    cursor: 'pointer',
                    letterSpacing: 0.5,
                    transition: 'all 0.2s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    flex: 1,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = SHADOWS.glowStrongBlue;
                    e.currentTarget.style.background = GRADIENTS.accentBlueReverse;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                    e.currentTarget.style.background = GRADIENTS.accentBlue;
                  }}
                  onTouchStart={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = SHADOWS.glowStrongBlue;
                    e.currentTarget.style.background = GRADIENTS.accentBlueReverse;
                  }}
                  onTouchEnd={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                    e.currentTarget.style.background = GRADIENTS.accentBlue;
                  }}>
                  ▶ RETRY
                </button>
                <button
                  onClick={() => { setShowLeaderboard(false); setGamePhase('idle'); }}
                  style={{
                    background: 'transparent',
                    color: NINJA_THEME.accentPrimary,
                    border: `1.5px solid ${NINJA_THEME.accentPrimary}`,
                    borderRadius: BORDER_RADIUS.button,
                    boxShadow: 'none',
                    fontFamily: '"Press Start 2P", monospace',
                    fontSize: 11,
                    padding: '12px 18px',
                    minHeight: 44,
                    cursor: 'pointer',
                    letterSpacing: 0.5,
                    transition: 'all 0.2s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    flex: 1,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                    e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.background = 'transparent';
                  }}
                  onTouchStart={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                    e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                  }}
                  onTouchEnd={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.background = 'transparent';
                  }}>
                  MENU
                </button>
              </div>

              <div style={{ color: 'rgba(230, 245, 255, 0.35)', fontSize: 6, fontFamily: '"Press Start 2P", monospace', marginTop: SPACING.md }}>
                PRESS ENTER TO RESTART
              </div>
            </div>
          </div>
        )}

        {showLeaderboard && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${NINJA_THEME.bg}, ${NINJA_THEME.bgSecondary})`,
            padding: 16,
            zIndex: 30,
            animation: 'fadeIn 0.2s ease',
            overflow: 'hidden',
          }}>
            {/* Ambient Background Blobs */}
            <div style={{
              position: 'absolute',
              top: '-15%', left: '-15%',
              width: '60%', height: '60%',
              background: `radial-gradient(circle, ${NINJA_THEME.accentPrimary}1A 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(50px)',
              pointerEvents: 'none',
              animation: 'floatBlob1 20s ease-in-out infinite alternate',
              zIndex: 1,
            }} />
            <div style={{
              position: 'absolute',
              bottom: '-15%', right: '-15%',
              width: '60%', height: '60%',
              background: `radial-gradient(circle, ${NINJA_THEME.accentSecondary}1A 0%, transparent 70%)`,
              borderRadius: '50%',
              filter: 'blur(50px)',
              pointerEvents: 'none',
              animation: 'floatBlob2 25s ease-in-out infinite alternate',
              zIndex: 1,
            }} />
            <div style={{
              width: '100%', maxWidth: 360,
              background: 'rgba(11, 23, 50, 0.9)',
              border: `1.5px solid ${NINJA_THEME.accentPrimary}`,
              borderRadius: BORDER_RADIUS.container,
              boxShadow: SHADOWS.glowMediumBlue,
              backdropFilter: 'blur(8px)',
              padding: 20,
              color: NINJA_THEME.text,
              position: 'relative',
              zIndex: 5,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{
                  background: GRADIENTS.accentBlue,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  fontFamily: FONT_FAMILY.display,
                  fontSize: 14,
                  lineHeight: 1.3,
                  letterSpacing: 0.5,
                  filter: 'drop-shadow(0 0 12px rgba(57, 195, 255, 0.4))',
                }}>
                  🏆 LEADERBOARD<br />
                  <span style={{ fontSize: 8, fontFamily: '"Press Start 2P", monospace', WebkitTextFillColor: 'rgba(230, 245, 255, 0.7)', letterSpacing: 1 }}>TOP 5 RUNNERS</span>
                </div>
                <button
                  onClick={() => setShowLeaderboard(false)}
                  style={{
                    background: 'transparent',
                    color: NINJA_THEME.accentPrimary,
                    border: `1.5px solid ${NINJA_THEME.accentPrimary}`,
                    borderRadius: BORDER_RADIUS.button,
                    fontFamily: '"Press Start 2P", monospace',
                    padding: '8px 12px',
                    fontSize: 10,
                    minHeight: 44,
                    minWidth: 44,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >✕</button>
              </div>

              {lbLoading ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: NINJA_THEME.accentPrimary, fontSize: 8 }}>
                  ⏳ LOADING...
                </div>
              ) : topScores.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(230, 245, 255, 0.5)', fontSize: 7, lineHeight: 2 }}>
                  NO RUNS YET
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {topScores.map((entry, index) => {
                    const isCurrentPlayer = !!walletData.address && entry.player.toLowerCase() === walletData.address.toLowerCase();
                    const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
                    const rankIcon = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
                    return (
                      <div
                        key={`${entry.player}-${entry.timestamp}-${index}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          background: isCurrentPlayer ? 'rgba(57, 195, 255, 0.12)' : 'rgba(11, 23, 50, 0.6)',
                          border: `1.5px solid ${index < 3 ? rankColors[index] : 'rgba(57, 195, 255, 0.2)'}`,
                          borderRadius: BORDER_RADIUS.card,
                          boxShadow: index < 3 ? `0 0 12px ${rankColors[index]}33` : 'none',
                        }}
                      >
                        <div style={{
                          width: 32, height: 32,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: index < 3 ? 'rgba(255, 215, 0, 0.15)' : 'rgba(11, 23, 50, 0.8)',
                          color: index < 3 ? rankColors[index] : 'rgba(230, 245, 255, 0.7)',
                          fontSize: index < 3 ? 12 : 10,
                          borderRadius: BORDER_RADIUS.button,
                          border: `1px solid ${index < 3 ? rankColors[index] : 'rgba(255, 255, 255, 0.15)'}`,
                          fontWeight: 'bold',
                        }}>{rankIcon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                            <div style={{ color: isCurrentPlayer ? NINJA_THEME.accentPrimary : NINJA_THEME.text, fontSize: 6, fontFamily: '"Press Start 2P", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {formatAddress(entry.player)}{isCurrentPlayer ? ' · YOU' : ''}
                            </div>
                            <div style={{ color: NINJA_THEME.accentPrimary, fontSize: 6, fontFamily: '"Press Start 2P", monospace', fontWeight: 'bold' }}>{entry.score}</div>
                          </div>
                          <div style={{ color: 'rgba(230, 245, 255, 0.4)', fontSize: 5, fontFamily: '"Press Start 2P", monospace' }}>
                            {new Date(entry.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => setShowLeaderboard(false)}
                style={{
                  background: 'transparent',
                  color: NINJA_THEME.accentPrimary,
                  border: `1.5px solid ${NINJA_THEME.accentPrimary}`,
                  borderRadius: BORDER_RADIUS.button,
                  boxShadow: 'none',
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 10,
                  padding: '12px 24px',
                  minHeight: 44,
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                  transition: 'all 0.2s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  width: '100%',
                  marginTop: 14,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                  e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.background = 'transparent';
                }}
                onTouchStart={e => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = SHADOWS.glowMediumBlue;
                  e.currentTarget.style.background = 'rgba(57, 195, 255, 0.15)';
                }}
                onTouchEnd={e => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.background = 'transparent';
                }}>
                BACK
              </button>
            </div>
          </div>
        )}

        {/* ── JUMP BUTTON — bottom right, mobile friendly ── */}
        {gamePhase === 'playing' && (
          <button
            onPointerDown={(e) => { e.preventDefault(); jump(); }}
            style={{
              position: 'absolute',
              bottom: 28,
              right: 24,
              width: 80,
              height: 80,
              background: 'rgba(57,255,20,0.12)',
              border: `3px solid ${PAL.neon}`,
              boxShadow: `0 0 20px ${PAL.neon}60, 4px 4px 0 #000`,
              borderRadius: 0,
              color: PAL.neon,
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 10,
              cursor: 'pointer',
              touchAction: 'none',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 4,
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 22 }}>▲</span>
            <span style={{ fontSize: 7 }}>JUMP</span>
          </button>
        )}

        {/* Flash overlay for level up (DOM layer) */}
        {flashMsg && (
          <div style={{
            position: 'absolute', top: '35%', left: 0, right: 0,
            textAlign: 'center', pointerEvents: 'none', zIndex: 15,
          }}>
            <span style={{
              color: PAL.amber,
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 18,
              textShadow: `0 0 20px ${PAL.amber}, 2px 2px 0 #000`,
              animation: 'pop 0.3s ease',
            }}>{flashMsg}</span>
          </div>
        )}
      </div>
    );
  }