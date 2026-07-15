import { TILE } from './dungeon.js';
import { getWorldTile, WORLD_OBJECT, WORLD_TERRAIN } from './world-map.js';

const INK = '#392f35';
const CREAM = '#fff8e9';
const WORLD_TILE_WIDTH = 64;
const WORLD_TILE_HEIGHT = 32;
const WORLD_TILE_DEPTH = 6;
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
    const world = snapshot.worldMap;
    const camera = world.partyPosition;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2 + 24;

    ctx.fillStyle = '#8caed0';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const visibleTiles = [];
    const cameraX = Math.floor(camera.x);
    const cameraY = Math.floor(camera.y);
    for (let y = cameraY - 18; y <= cameraY + 18; y += 1) {
      for (let x = cameraX - 18; x <= cameraX + 18; x += 1) {
        const screen = this.projectWorldPoint(x, y, camera, centerX, centerY);
        if (screen.x < -WORLD_TILE_WIDTH || screen.x > this.canvas.width + WORLD_TILE_WIDTH
          || screen.y < -WORLD_TILE_HEIGHT * 2 || screen.y > this.canvas.height + WORLD_TILE_HEIGHT * 2) continue;
        visibleTiles.push({
          x,
          y,
          screen,
          tile: getWorldTile(world, x, y) ?? { x, y, terrain: WORLD_TERRAIN.WATER, object: null }
        });
      }
    }
    visibleTiles.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);

    for (const entry of visibleTiles) this.drawWorldTile(entry, world, timeMs);
    for (const entry of visibleTiles) {
      if (entry.tile.object) this.drawWorldObject(entry, snapshot.dungeonRun, timeMs);
    }

    const partyOffsets = [[-24, -11], [20, -11], [-17, 20], [18, 20]];
    snapshot.party.forEach((member, index) => {
      const [dx, dy] = partyOffsets[index];
      this.drawCharacter(member, centerX + dx, centerY + dy, .78, timeMs);
    });

    const nextDungeon = this.data.dungeons[snapshot.dungeonRun % this.data.dungeons.length];
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgb(255 248 233 / 92%)';
    this.roundRect(24, 24, 390, 104, 16, true, true);
    ctx.fillStyle = INK;
    ctx.font = 'bold 23px Trebuchet MS';
    ctx.fillText(snapshot.worldMap.arrived ? '地下城入口已抵達' : '沿著道路前進中', 45, 59);
    ctx.font = 'bold 18px Trebuchet MS';
    ctx.fillText(`${nextDungeon.name}　難度 ${snapshot.dungeonRun + 1}`, 45, 89);
    ctx.font = '14px Trebuchet MS';
    ctx.fillText(`地圖延展 ${world.destinations.length} 區｜路程 ${Math.round(snapshot.worldTravelProgress * 100)}%`, 45, 114);
  }

  projectWorldPoint(worldX, worldY, camera, centerX, centerY) {
    const dx = worldX - camera.x;
    const dy = worldY - camera.y;
    return {
      x: centerX + (dx - dy) * WORLD_TILE_WIDTH / 2,
      y: centerY + (dx + dy) * WORLD_TILE_HEIGHT / 2
    };
  }

  drawWorldTile(entry, world, timeMs) {
    const ctx = this.context;
    const { x, y, tile, screen } = entry;
    const halfWidth = WORLD_TILE_WIDTH / 2;
    const halfHeight = WORLD_TILE_HEIGHT / 2;
    const isWater = tile.terrain === WORLD_TERRAIN.WATER;
    const parity = Math.abs(x * 7 + y * 11) % 3;
    const colors = tile.terrain === WORLD_TERRAIN.GRASS
      ? ['#91d957', '#98df5e', '#88cf51']
      : tile.terrain === WORLD_TERRAIN.ROAD
        ? ['#d4aa63', '#ddb66f', '#cda05a']
        : ['#8caed0', '#91b4d5', '#87a9cb'];

    if (!isWater) {
      ctx.fillStyle = tile.terrain === WORLD_TERRAIN.ROAD ? '#a87942' : '#5f9c43';
      ctx.beginPath();
      ctx.moveTo(screen.x - halfWidth, screen.y);
      ctx.lineTo(screen.x, screen.y + halfHeight);
      ctx.lineTo(screen.x, screen.y + halfHeight + WORLD_TILE_DEPTH);
      ctx.lineTo(screen.x - halfWidth, screen.y + WORLD_TILE_DEPTH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = tile.terrain === WORLD_TERRAIN.ROAD ? '#b8894d' : '#72ac4c';
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y + halfHeight);
      ctx.lineTo(screen.x + halfWidth, screen.y);
      ctx.lineTo(screen.x + halfWidth, screen.y + WORLD_TILE_DEPTH);
      ctx.lineTo(screen.x, screen.y + halfHeight + WORLD_TILE_DEPTH);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = colors[parity];
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y - halfHeight);
    ctx.lineTo(screen.x + halfWidth, screen.y);
    ctx.lineTo(screen.x, screen.y + halfHeight);
    ctx.lineTo(screen.x - halfWidth, screen.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = isWater ? 'rgb(65 104 145 / 5%)' : 'rgb(57 47 53 / 12%)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isWater) {
      if ((Math.abs(x * 13 + y * 5) % 7) === 0) {
        ctx.strokeStyle = 'rgb(232 246 255 / 48%)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(screen.x - 9, screen.y + Math.sin(timeMs / 700 + x) * 1.5);
        ctx.lineTo(screen.x + 8, screen.y + Math.sin(timeMs / 700 + y) * 1.5);
        ctx.stroke();
      }
      return;
    }

    const edgeColor = tile.terrain === WORLD_TERRAIN.GRASS ? '#e5f4a8' : '#f2d58d';
    const neighbors = [
      [x - 1, y, [-halfWidth, 0, 0, -halfHeight]],
      [x, y - 1, [0, -halfHeight, halfWidth, 0]],
      [x + 1, y, [halfWidth, 0, 0, halfHeight]],
      [x, y + 1, [0, halfHeight, -halfWidth, 0]]
    ];
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 2;
    for (const [neighborX, neighborY, edge] of neighbors) {
      if (getWorldTile(world, neighborX, neighborY)?.terrain !== WORLD_TERRAIN.WATER
        && getWorldTile(world, neighborX, neighborY) !== null) continue;
      ctx.beginPath();
      ctx.moveTo(screen.x + edge[0], screen.y + edge[1]);
      ctx.lineTo(screen.x + edge[2], screen.y + edge[3]);
      ctx.stroke();
    }
  }

  drawWorldObject(entry, activeDungeonRun, timeMs) {
    const { tile, screen } = entry;
    const ctx = this.context;
    const baseY = screen.y + 7;
    ctx.save();
    ctx.translate(Math.round(screen.x), Math.round(baseY));
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (tile.object === WORLD_OBJECT.TREE) this.drawWorldTree();
    else if (tile.object === WORLD_OBJECT.BUSH) this.drawWorldBush();
    else if (tile.object === WORLD_OBJECT.LARGE_ROCK) this.drawWorldRock(1);
    else if (tile.object === WORLD_OBJECT.SMALL_ROCK) this.drawWorldRock(.62);
    else if (tile.object === WORLD_OBJECT.DUNGEON) {
      this.drawWorldDungeonEntrance(tile, tile.dungeonRun === activeDungeonRun, timeMs);
    }
    ctx.restore();
  }

  drawWorldTree() {
    const ctx = this.context;
    ctx.lineWidth = 2.2;
    ctx.fillStyle = '#8b6542';
    ctx.fillRect(-4, -27, 8, 29);
    ctx.strokeRect(-4, -27, 8, 29);
    const layers = [
      { y: -49, width: 18, color: '#4b9f4f' },
      { y: -37, width: 23, color: '#58ad56' },
      { y: -24, width: 27, color: '#65ba5d' }
    ];
    for (const layer of layers) {
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(0, layer.y - 15);
      ctx.lineTo(layer.width, layer.y + 13);
      ctx.lineTo(-layer.width, layer.y + 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawWorldBush() {
    const ctx = this.context;
    ctx.fillStyle = '#4f9f4b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(-10, -7, 12, 10, -.2, 0, Math.PI * 2);
    ctx.ellipse(3, -11, 14, 13, 0, 0, Math.PI * 2);
    ctx.ellipse(14, -6, 10, 9, .2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawWorldRock(scale) {
    const ctx = this.context;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#918b91';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-13, -18);
    ctx.lineTo(2, -28);
    ctx.lineTo(18, -16);
    ctx.lineTo(22, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#6e686f';
    ctx.beginPath();
    ctx.moveTo(2, -28);
    ctx.lineTo(3, -7);
    ctx.lineTo(18, -16);
    ctx.stroke();
  }

  drawWorldDungeonEntrance(tile, active, timeMs) {
    const ctx = this.context;
    const pulse = active ? 1 + Math.sin(timeMs / 240) * .06 : 1;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = tile.themeColor ?? '#c98975';
    ctx.lineWidth = active ? 3.5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(-24, 1);
    ctx.lineTo(-20, -28);
    ctx.lineTo(0, -45);
    ctx.lineTo(22, -27);
    ctx.lineTo(25, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#312b34';
    ctx.beginPath();
    ctx.arc(0, -8, 10, Math.PI, Math.PI * 2);
    ctx.lineTo(10, 1);
    ctx.lineTo(-10, 1);
    ctx.closePath();
    ctx.fill();
    if (active) {
      ctx.fillStyle = '#ffe88a';
      ctx.beginPath();
      ctx.arc(19, -40, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
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
