import { TILE } from './dungeon.js';

const INK = '#392f35';
const CREAM = '#fff8e9';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class GameRenderer {
  constructor(canvas, data) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.context.imageSmoothingEnabled = false;
    this.data = data;
  }

  render(snapshot, timeMs) {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (snapshot.scene === 'world') this.renderWorld(snapshot, timeMs);
    else this.renderDungeon(snapshot, timeMs);
  }

  renderWorld(snapshot, timeMs) {
    const ctx = this.context;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, '#b9d9ef');
    gradient.addColorStop(0.56, '#d7e5c1');
    gradient.addColorStop(1, '#8fbd85');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawCloud(130, 92, 1.3);
    this.drawCloud(700, 74, 1);
    this.drawHill(95, 340, 280, '#85a997');
    this.drawHill(640, 350, 370, '#7da687');

    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e8d7a9';
    ctx.beginPath();
    ctx.moveTo(200, 430);
    ctx.bezierCurveTo(350, 330, 480, 440, 735, 270);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();

    const dungeons = this.data.dungeons;
    const activeIndex = snapshot.dungeonRun % dungeons.length;
    dungeons.forEach((dungeon, index) => {
      const x = index === 0 ? 735 : 455;
      const y = index === 0 ? 245 : 370;
      this.drawDungeonEntrance(x, y, dungeon.themeColor, index === activeIndex);
      ctx.fillStyle = INK;
      ctx.font = 'bold 16px Trebuchet MS';
      ctx.textAlign = 'center';
      ctx.fillText(dungeon.name, x, y + 68);
    });

    const partyOffsets = [[-42, -22], [2, -24], [-24, 24], [24, 22]];
    snapshot.party.forEach((member, index) => {
      const [dx, dy] = partyOffsets[index];
      this.drawCharacter(member, 205 + dx, 410 + dy, 1.15, timeMs);
    });

    const nextDungeon = dungeons[activeIndex];
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgb(255 248 233 / 92%)';
    this.roundRect(24, 24, 390, 100, 16, true, true);
    ctx.fillStyle = INK;
    ctx.font = 'bold 25px Trebuchet MS';
    ctx.fillText('朋友們的下一站', 45, 62);
    ctx.font = 'bold 18px Trebuchet MS';
    ctx.fillText(`${nextDungeon.name}　難度 ${snapshot.dungeonRun + 1}`, 45, 93);
    ctx.font = '14px Trebuchet MS';
    ctx.fillText(`已攻克 ${snapshot.dungeonRun} 座地下城`, 45, 115);
  }

  renderDungeon(snapshot, timeMs) {
    const { floor } = snapshot;
    const ctx = this.context;
    const tileSize = Math.floor(Math.min(this.canvas.width / floor.width, this.canvas.height / floor.height));
    const offsetX = Math.floor((this.canvas.width - floor.width * tileSize) / 2);
    const offsetY = Math.floor((this.canvas.height - floor.height * tileSize) / 2);
    const theme = snapshot.dungeon?.themeColor ?? '#6d8f72';

    ctx.fillStyle = '#221e25';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < floor.height; y += 1) {
      for (let x = 0; x < floor.width; x += 1) {
        this.drawTile(floor.tiles[y][x], x, y, tileSize, offsetX, offsetY, theme, snapshot.floorCleared, timeMs);
      }
    }

    for (const enemy of snapshot.enemies) this.drawEnemy(enemy, tileSize, offsetX, offsetY, timeMs);

    const partyOffsets = [[-.48, -.38], [.42, -.38], [-.48, .48], [.42, .48]];
    snapshot.party.forEach((member, index) => {
      const [dx, dy] = partyOffsets[index];
      const x = offsetX + (snapshot.partyPosition.x + 0.5 + dx) * tileSize;
      const y = offsetY + (snapshot.partyPosition.y + 0.5 + dy) * tileSize;
      this.drawCharacter(member, x, y, Math.max(.42, tileSize / 25), timeMs);
    });

    this.drawDungeonHud(snapshot);
    const boss = snapshot.enemies.find((enemy) => enemy.isBoss);
    if (boss) this.drawBossBar(boss);
  }

  drawTile(tile, gridX, gridY, size, offsetX, offsetY, theme, floorCleared, timeMs) {
    const ctx = this.context;
    const x = offsetX + gridX * size;
    const y = offsetY + gridY * size;
    if (tile === TILE.WALL) {
      ctx.fillStyle = '#312b34';
      ctx.fillRect(x, y, size, size);
      if ((gridX + gridY) % 2 === 0) {
        ctx.fillStyle = '#3e3641';
        ctx.fillRect(x + 2, y + 2, size - 3, Math.max(2, size * .18));
      }
      return;
    }

    ctx.globalAlpha = (gridX + gridY) % 2 === 0 ? .88 : .74;
    ctx.fillStyle = theme;
    ctx.fillRect(x, y, size, size);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgb(57 47 53 / 16%)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);

    if (tile === TILE.ENTRANCE) {
      ctx.fillStyle = '#b9d9ef';
      ctx.fillRect(x + size * .2, y + size * .2, size * .6, size * .6);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + size * .2, y + size * .2, size * .6, size * .6);
    } else if (tile === TILE.STAIRS) {
      const pulse = floorCleared ? 0.75 + Math.sin(timeMs / 160) * .2 : .35;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = floorCleared ? '#f4d979' : '#6a6068';
      for (let step = 0; step < 3; step += 1) {
        ctx.fillRect(x + size * (.16 + step * .1), y + size * (.2 + step * .2), size * (.68 - step * .2), size * .15);
      }
      ctx.globalAlpha = 1;
      if (!floorCleared) {
        ctx.fillStyle = INK;
        ctx.font = `bold ${Math.max(11, size * .58)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('×', x + size / 2, y + size * .68);
      }
    }
  }

  drawCharacter(member, x, y, scale, timeMs) {
    const ctx = this.context;
    const attackFrame = member.attackingMs > 0 && Math.floor(timeMs / 100) % 2 === 1;
    const lean = attackFrame ? 5 * scale : 0;
    const size = 18 * scale;
    ctx.save();
    ctx.translate(Math.round(x + lean), Math.round(y));
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    ctx.strokeStyle = INK;
    ctx.fillStyle = member.color;

    if (member.role === 'Tank' || member.role === 'Striker') {
      ctx.beginPath();
      ctx.arc(-size * .28, -size * .46, size * .22, 0, Math.PI * 2);
      ctx.arc(size * .28, -size * .46, size * .22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (member.role === 'Caster') {
      ctx.beginPath();
      ctx.moveTo(-size * .42, -size * .35);
      ctx.lineTo(-size * .28, -size * .88);
      ctx.lineTo(-size * .02, -size * .48);
      ctx.moveTo(size * .42, -size * .35);
      ctx.lineTo(size * .28, -size * .88);
      ctx.lineTo(size * .02, -size * .48);
      ctx.fill();
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, -size * .2, size * .55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, size * .45, size * .48, size * .5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-size * .18, -size * .28, Math.max(1, size * .055), 0, Math.PI * 2);
    ctx.arc(size * .18, -size * .28, Math.max(1, size * .055), 0, Math.PI * 2);
    ctx.fill();

    if (member.role === 'Healer') {
      ctx.fillStyle = '#ef9a4d';
      ctx.beginPath();
      ctx.moveTo(-size * .12, -size * .1);
      ctx.lineTo(size * .3, 0);
      ctx.lineTo(-size * .12, size * .08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.beginPath();
    const armReach = attackFrame ? size * 1.05 : size * .55;
    ctx.moveTo(size * .28, size * .28);
    ctx.lineTo(armReach, attackFrame ? size * .05 : size * .42);
    ctx.stroke();
    if (attackFrame) {
      ctx.fillStyle = '#fff7c8';
      ctx.beginPath();
      ctx.arc(size * 1.12, size * .02, size * .16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawEnemy(enemy, tileSize, offsetX, offsetY, timeMs) {
    const ctx = this.context;
    const attackFrame = enemy.attackingMs > 0 && Math.floor(timeMs / 90) % 2 === 1;
    const x = offsetX + (enemy.x + .5) * tileSize + (attackFrame ? -3 : 0);
    const y = offsetY + (enemy.y + .5) * tileSize;
    const radius = enemy.isBoss ? tileSize * .72 : tileSize * .36;

    ctx.save();
    ctx.translate(x, y);
    if (attackFrame) ctx.rotate(-.12);
    ctx.fillStyle = enemy.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = enemy.isBoss ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(-radius, radius * .52);
    ctx.quadraticCurveTo(-radius * 1.1, -radius * .65, -radius * .35, -radius * .85);
    ctx.quadraticCurveTo(0, -radius * 1.25, radius * .35, -radius * .85);
    ctx.quadraticCurveTo(radius * 1.1, -radius * .65, radius, radius * .52);
    ctx.quadraticCurveTo(radius * .45, radius * .82, 0, radius * .56);
    ctx.quadraticCurveTo(-radius * .45, radius * .82, -radius, radius * .52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(-radius * .42, -radius * .28, Math.max(2, radius * .13), Math.max(2, radius * .13));
    ctx.fillRect(radius * .28, -radius * .28, Math.max(2, radius * .13), Math.max(2, radius * .13));
    ctx.restore();

    if (!enemy.isBoss) this.drawHealthBar(x - tileSize * .38, y - tileSize * .62, tileSize * .76, 5, enemy.hp / enemy.maxHp);
  }

  drawHealthBar(x, y, width, height, ratio) {
    const ctx = this.context;
    ctx.fillStyle = INK;
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    ctx.fillStyle = '#e4d9d1';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#dd7180';
    ctx.fillRect(x, y, width * clamp(ratio, 0, 1), height);
  }

  drawBossBar(boss) {
    const ctx = this.context;
    const width = 430;
    const x = (this.canvas.width - width) / 2;
    ctx.fillStyle = 'rgb(34 30 37 / 82%)';
    this.roundRect(x - 18, 12, width + 36, 52, 12, true, false);
    ctx.fillStyle = CREAM;
    ctx.font = 'bold 15px Trebuchet MS';
    ctx.textAlign = 'center';
    ctx.fillText(boss.name, this.canvas.width / 2, 33);
    this.drawHealthBar(x, 43, width, 10, boss.hp / boss.maxHp);
  }

  drawDungeonHud(snapshot) {
    const ctx = this.context;
    ctx.fillStyle = 'rgb(34 30 37 / 80%)';
    this.roundRect(12, 12, 190, 54, 10, true, false);
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px Trebuchet MS';
    ctx.fillText(`第 ${snapshot.floorNumber} / 3 層`, 26, 35);
    ctx.font = '13px Trebuchet MS';
    ctx.fillText(snapshot.floorCleared ? '樓梯已解鎖' : `剩餘敵人 ${snapshot.enemies.length}`, 26, 56);
  }

  drawCloud(x, y, scale) {
    const ctx = this.context;
    ctx.fillStyle = 'rgb(255 255 255 / 72%)';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 25 * scale, Math.PI * .8, Math.PI * 2.1);
    ctx.arc(x + 34 * scale, y - 10 * scale, 31 * scale, Math.PI, Math.PI * 2);
    ctx.arc(x + 70 * scale, y, 25 * scale, Math.PI, Math.PI * 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawHill(x, y, width, color) {
    const ctx = this.context;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - width / 2, this.canvas.height);
    ctx.quadraticCurveTo(x, y - width * .34, x + width / 2, this.canvas.height);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawDungeonEntrance(x, y, color, active) {
    const ctx = this.context;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = active ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(x - 45, y + 40);
    ctx.lineTo(x - 35, y - 25);
    ctx.lineTo(x, y - 52);
    ctx.lineTo(x + 38, y - 18);
    ctx.lineTo(x + 45, y + 40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#302a33';
    ctx.beginPath();
    ctx.arc(x, y + 22, 18, Math.PI, Math.PI * 2);
    ctx.lineTo(x + 18, y + 40);
    ctx.lineTo(x - 18, y + 40);
    ctx.closePath();
    ctx.fill();
    if (active) {
      ctx.fillStyle = '#f4d979';
      ctx.beginPath();
      ctx.arc(x + 35, y - 37, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  roundRect(x, y, width, height, radius, fill, stroke) {
    const ctx = this.context;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) ctx.fill();
    if (stroke) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

export default GameRenderer;
