import { loadGameAssets } from './game/assets.js';
import { SoundEngine } from './game/audio.js';
import { Game } from './game/Game.js';
import type {
  DamageEvent,
  GamePhase,
  HudState,
  RunSummary,
  StatChange,
  UpgradeCard,
  UpgradeRarity,
} from './game/types.js';
import { formatStat, rarityLabel } from './game/upgrades.js';

const canvas = getElement<HTMLCanvasElement>('game-canvas');
const hud = getElement<HTMLElement>('hud');
const damageLayer = getElement<HTMLElement>('damage-layer');
const startScreen = getElement<HTMLElement>('start-screen');
const upgradeScreen = getElement<HTMLElement>('upgrade-screen');
const pauseScreen = getElement<HTMLElement>('pause-screen');
const gameoverScreen = getElement<HTMLElement>('gameover-screen');
const startButton = getElement<HTMLButtonElement>('start-button');
const pauseButton = getElement<HTMLButtonElement>('pause-button');
const resumeButton = getElement<HTMLButtonElement>('resume-button');
const restartButton = getElement<HTMLButtonElement>('restart-button');
const upgradeGrid = getElement<HTMLElement>('upgrade-grid');
const upgradeAsh = getElement<HTMLElement>('upgrade-ash');
const upgradeLevelValue = getElement<HTMLElement>('upgrade-level-value');
const upgradeSignal = getElement<HTMLElement>('upgrade-signal');
const soundToggle = getElement<HTMLButtonElement>('sound-toggle');
const soundToggleState = getElement<HTMLElement>('sound-toggle-state');
const levelValue = getElement<HTMLElement>('level-value');
const healthFill = getElement<HTMLElement>('health-fill');
const healthText = getElement<HTMLElement>('health-text');
const xpFill = getElement<HTMLElement>('xp-fill');
const xpText = getElement<HTMLElement>('xp-text');
const timeValue = getElement<HTMLElement>('time-value');
const killValue = getElement<HTMLElement>('kill-value');
const waveValue = getElement<HTMLElement>('wave-value');
const regenValue = getElement<HTMLElement>('regen-value');
const resultTime = getElement<HTMLElement>('result-time');
const resultKills = getElement<HTMLElement>('result-kills');
const resultLevel = getElement<HTMLElement>('result-level');
const errorMessage = document.createElement('p');
errorMessage.className = 'load-error';
errorMessage.textContent = '游戏资源加载失败，请刷新页面重试。';

let game: Game | undefined;
let upgradeChoiceLocked = false;
/** 全局唯一的音效引擎，暂停面板的开关和 Game 内部触发点共用它。 */
const audio = new SoundEngine();

const RARITY_ORDER: Record<UpgradeRarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
};

const RARITY_SIGNAL: Record<UpgradeRarity, string> = {
  common: '战地改装数据已接入',
  rare: '异常强化信号已锁定',
  epic: '高危军械协议已解锁',
};

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少元素 #${id}`);
  return element as T;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function setVisible(element: HTMLElement, visible: boolean): void {
  element.classList.toggle('hidden', !visible);
}

function clearDamageNumbers(): void {
  damageLayer.replaceChildren();
}

function renderDamage(event: DamageEvent): void {
  const number = document.createElement('span');
  number.className = event.headshot
    ? 'damage-number headshot'
    : event.critical
      ? 'damage-number critical'
      : 'damage-number';
  number.textContent = event.headshot ? '爆头' : String(event.amount);
  number.style.left = `${event.screenX}px`;
  number.style.top = `${event.screenY}px`;
  number.style.setProperty('--damage-drift-x', `${(Math.random() - 0.5) * 28}px`);
  number.style.setProperty('--damage-drift-y', `${-38 - Math.random() * 24}px`);
  number.style.setProperty('--damage-tilt', `${(Math.random() - 0.5) * 12}deg`);
  number.addEventListener('animationend', () => number.remove(), { once: true });
  damageLayer.append(number);

  if (damageLayer.childElementCount > 56) {
    damageLayer.firstElementChild?.remove();
  }
}

function renderHud(state: HudState): void {
  const healthRatio = Math.max(0, state.health / state.maxHealth);
  const xpRatio = Math.max(0, Math.min(1, state.xp / state.xpToNext));
  levelValue.textContent = String(state.level);
  healthFill.style.width = `${healthRatio * 100}%`;
  healthText.textContent = `${Math.ceil(state.health)} / ${Math.round(state.maxHealth)}`;
  xpFill.style.width = `${xpRatio * 100}%`;
  xpText.textContent = `${Math.floor(state.xp)} / ${state.xpToNext}`;
  timeValue.textContent = formatTime(state.elapsed);
  killValue.textContent = String(state.kills);
  waveValue.textContent = String(state.wave);
  regenValue.textContent = formatStat('regen', state.regen);
  hud.classList.toggle('danger', healthRatio <= 0.3);
}

function renderPhase(phase: GamePhase): void {
  document.body.dataset.phase = phase;
  if (phase !== 'running') clearDamageNumbers();
  setVisible(startScreen, phase === 'ready');
  setVisible(pauseScreen, phase === 'paused');
  setVisible(upgradeScreen, phase === 'upgrade');
  setVisible(gameoverScreen, phase === 'gameover');
  pauseButton.disabled = phase !== 'running' && phase !== 'paused';
}

function renderSoundToggle(): void {
  const enabled = audio.isEnabled;
  soundToggle.dataset.enabled = String(enabled);
  soundToggle.setAttribute('aria-checked', String(enabled));
  soundToggleState.textContent = enabled ? '开启' : '关闭';
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character,
  );
}

function renderStatRows(changes: StatChange[]): string {
  if (changes.length === 0) return '';

  const rows = changes
    .map(
      (change) => `
              <span class="card-stat">
                <em>${escapeHtml(change.label)}</em>
                <b class="stat-from">${escapeHtml(change.from)}</b>
                <span class="stat-arrow">&rarr;</span>
                <b class="stat-to ${change.up ? 'up' : 'down'}">${escapeHtml(change.to)}</b>
              </span>`,
    )
    .join('');

  return `<span class="card-stats">${rows}</span>`;
}

function renderStackLabel(card: UpgradeCard): string {
  return card.stacks > 0 ? `已强化 ${card.stacks} 层` : '新强化';
}

function highestRarity(cards: UpgradeCard[]): UpgradeRarity {
  return cards.reduce<UpgradeRarity>(
    (highest, card) => (RARITY_ORDER[card.rarity] > RARITY_ORDER[highest] ? card.rarity : highest),
    'common',
  );
}

function renderUpgrades(cards: UpgradeCard[]): void {
  upgradeChoiceLocked = false;
  const rarity = highestRarity(cards);
  upgradeScreen.dataset.rarity = rarity;
  upgradeLevelValue.textContent = String(levelValue.textContent).padStart(2, '0');
  upgradeSignal.textContent = RARITY_SIGNAL[rarity];

  upgradeGrid.innerHTML = cards
    .map(
      (card, index) => `
        <button
          class="upgrade-card rarity-${card.rarity}"
          style="--deal-order: ${index}"
          type="button"
          data-upgrade="${card.id}"
        >
          <span class="card-shell">
            <span class="card-face card-back" aria-hidden="true">
              <span class="card-back-grid"></span>
              <span class="card-back-brand">FIELD MUTATION</span>
              <span class="card-back-sigil"><i>✦</i></span>
              <span class="card-back-code">MOD ${String(index + 1).padStart(2, '0')}</span>
            </span>
            <span class="card-face card-front">
              <span class="card-topline">
                <span class="card-index">${String(index + 1).padStart(2, '0')}</span>
                <span class="card-rarity"><i></i>${rarityLabel(card.rarity)}</span>
              </span>
              <span class="card-icon"><i data-lucide="${card.icon}"></i></span>
              <span class="card-copy">
                <strong class="card-name">${escapeHtml(card.name)}</strong>
                <span class="card-description">${escapeHtml(card.description)}</span>
              </span>
              ${renderStatRows(card.changes)}
              <span class="card-footer">
                <span class="card-stack">${renderStackLabel(card)}</span>
                <span class="card-action">接入</span>
              </span>
            </span>
          </span>
        </button>
      `,
    )
    .join('');

  for (const button of upgradeGrid.querySelectorAll<HTMLButtonElement>('[data-upgrade]')) {
    button.addEventListener('click', () => {
      if (upgradeChoiceLocked) return;
      upgradeChoiceLocked = true;
      button.classList.add('selected');

      for (const peer of upgradeGrid.querySelectorAll<HTMLButtonElement>('[data-upgrade]')) {
        peer.disabled = true;
      }

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(
        () => game?.chooseUpgrade(button.dataset.upgrade ?? ''),
        reduceMotion ? 0 : 280,
      );
    });

    button.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const bounds = button.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const tiltX = ((0.5 - y) * 5).toFixed(2);
      const tiltY = ((x - 0.5) * 7).toFixed(2);
      button.style.setProperty('--pointer-x', `${(x * 100).toFixed(1)}%`);
      button.style.setProperty('--pointer-y', `${(y * 100).toFixed(1)}%`);
      button.style.setProperty('--tilt-x', `${tiltX}deg`);
      button.style.setProperty('--tilt-y', `${tiltY}deg`);
    });

    button.addEventListener('pointerleave', () => {
      button.style.removeProperty('--pointer-x');
      button.style.removeProperty('--pointer-y');
      button.style.setProperty('--tilt-x', '0deg');
      button.style.setProperty('--tilt-y', '0deg');
    });
  }
}

function renderGameOver(summary: RunSummary): void {
  resultTime.textContent = formatTime(summary.elapsed);
  resultKills.textContent = String(summary.kills);
  resultLevel.textContent = String(summary.level);
}

function seedUpgradeAtmosphere(): void {
  for (let index = 0; index < 18; index += 1) {
    const ember = document.createElement('i');
    ember.className = 'upgrade-ember';
    ember.style.setProperty('--ember-x', `${Math.round(Math.random() * 100)}%`);
    ember.style.setProperty('--ember-delay', `${(Math.random() * -9).toFixed(2)}s`);
    ember.style.setProperty('--ember-duration', `${(5.8 + Math.random() * 4.8).toFixed(2)}s`);
    ember.style.setProperty('--ember-drift', `${Math.round(-42 + Math.random() * 84)}px`);
    ember.style.setProperty('--ember-scale', `${(0.65 + Math.random() * 0.9).toFixed(2)}`);
    upgradeAsh.append(ember);
  }
}

async function bootstrap(): Promise<void> {
  try {
    const assets = await loadGameAssets();
    game = new Game(
      canvas,
      assets,
      {
        onHud: renderHud,
        onPhase: renderPhase,
        onUpgrade: renderUpgrades,
        onDamage: renderDamage,
        onGameOver: renderGameOver,
      },
      audio,
    );
    renderPhase('ready');
  } catch (error) {
    console.error(error);
    document.body.append(errorMessage);
  }
}

startButton.addEventListener('click', () => game?.startRun());
restartButton.addEventListener('click', () => game?.startRun());
resumeButton.addEventListener('click', () => game?.resume());
pauseButton.addEventListener('click', () => {
  if (document.body.dataset.phase === 'paused') game?.resume();
  else game?.pause();
});

soundToggle.addEventListener('click', () => {
  // 开关本身就是一次用户手势，顺便解锁 AudioContext
  audio.unlock();
  const enabled = audio.toggle();
  renderSoundToggle();
  // 打开时补一记提示音，用户才知道"声音回来了"；等主增益爬完再响
  if (enabled) window.setTimeout(() => audio.ui(), 90);
});

// 自动播放策略：AudioContext 只能在首次交互后创建 / 恢复
const unlockAudio = (): void => audio.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

window.addEventListener('beforeunload', () => {
  game?.dispose();
  audio.dispose();
});
renderSoundToggle();
seedUpgradeAtmosphere();
void bootstrap();
