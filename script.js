const GAME_SECONDS = 30;

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

function moveTarget() {
  const maxX = arena.clientWidth - target.offsetWidth;
  const maxY = arena.clientHeight - target.offsetHeight;
  target.style.left = `${Math.floor(Math.random() * maxX)}px`;
  target.style.top = `${Math.floor(Math.random() * maxY)}px`;
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
  isPlaying = true;
  scoreDisplay.textContent = score;
  timeDisplay.textContent = timeLeft;
  message.textContent = '遊戲進行中！';
  startButton.textContent = '重新開始';
  target.disabled = false;
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
  moveTarget();
});

startButton.addEventListener('click', startGame);
