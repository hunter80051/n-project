const GAME_SECONDS = 32;
const INITIAL_TARGET_SIZE = 56;

const arena = document.getElementById('arena');
const target = document.getElementById('target');
const scoreDisplay = document.getElementById('score');
const timeDisplay = document.getElementById('time');
const message = document.getElementById('message');
const startButton = document.getElementById('start-button');

let score = 0;
let timeLeft = GAME_SECONDS;
let timerId = null;
let isPlaying = false;
let targetSize = INITIAL_TARGET_SIZE;
let lastTargetCenter = null;

function moveTarget() {
  const halfWidth = target.offsetWidth / 2;
  const halfHeight = target.offsetHeight / 2;
  let newCenter;

  if (lastTargetCenter === null) {
    newCenter = {
      x: halfWidth + Math.random() * (arena.clientWidth - target.offsetWidth),
      y: halfHeight + Math.random() * (arena.clientHeight - target.offsetHeight)
    };
  } else {
    const maxDistance = Math.hypot(arena.clientWidth, arena.clientHeight) * 0.33;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * maxDistance;
    newCenter = {
      x: Math.min(arena.clientWidth - halfWidth, Math.max(halfWidth, lastTargetCenter.x + Math.cos(angle) * distance)),
      y: Math.min(arena.clientHeight - halfHeight, Math.max(halfHeight, lastTargetCenter.y + Math.sin(angle) * distance))
    };
  }

  target.style.left = `${newCenter.x - halfWidth}px`;
  target.style.top = `${newCenter.y - halfHeight}px`;

  lastTargetCenter = newCenter;
}

function increaseDifficulty() {
  targetSize *= 0.5;
  target.style.width = `${targetSize}px`;
  target.style.height = `${targetSize}px`;
}

function endGame() {
  clearInterval(timerId);
  timerId = null;
  isPlaying = false;
  target.disabled = true;
  message.textContent = `時間到！你的分數是 ${score} 分。`;
  startButton.textContent = '再玩一次';
}

function startGame() {
  clearInterval(timerId);
  score = 0;
  timeLeft = GAME_SECONDS;
  targetSize = INITIAL_TARGET_SIZE;
  target.style.width = `${targetSize}px`;
  target.style.height = `${targetSize}px`;
  isPlaying = true;
  scoreDisplay.textContent = score;
  timeDisplay.textContent = timeLeft;
  message.textContent = '遊戲進行中！';
  startButton.textContent = '重新開始';
  target.disabled = false;
  lastTargetCenter = null;
  moveTarget();

  timerId = setInterval(() => {
    timeLeft -= 1;
    timeDisplay.textContent = timeLeft;

    if (timeLeft === 0) {
      endGame();
    }
  }, 1000);
}

target.addEventListener('click', () => {
  if (!isPlaying) return;
  score += 1;
  scoreDisplay.textContent = score;

  // 增加難度門檻
  if (score % 10 === 0) {
    increaseDifficulty();
  }

  moveTarget();
});

startButton.addEventListener('click', startGame);
