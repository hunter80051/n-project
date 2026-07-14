const TABLE_SCHEMAS = {
  balance: {
    required: ['key', 'value', 'type', 'description']
  },
  characters: {
    required: ['characterId', 'name', 'role', 'color', 'spriteId', 'maxHp', 'maxSp', 'attack', 'defense', 'speed', 'attackRange', 'attackCooldownMs', 'basicSkillId', 'skillPoolId'],
    numbers: ['maxHp', 'maxSp', 'attack', 'defense', 'speed', 'attackRange', 'attackCooldownMs']
  },
  skills: {
    required: ['skillId', 'skillPoolId', 'name', 'description', 'effectType', 'targetType', 'power', 'spCost', 'cooldownMs', 'requiredLevel', 'iconId'],
    numbers: ['power', 'spCost', 'cooldownMs', 'requiredLevel']
  },
  enemies: {
    required: ['enemyId', 'name', 'tier', 'color', 'spriteId', 'maxHp', 'attack', 'defense', 'speed', 'attackRange', 'attackCooldownMs', 'xp', 'lootTableId', 'isBoss'],
    numbers: ['tier', 'maxHp', 'attack', 'defense', 'speed', 'attackRange', 'attackCooldownMs', 'xp'],
    booleans: ['isBoss']
  },
  items: {
    required: ['itemId', 'name', 'slot', 'rarity', 'iconId', 'attackBonus', 'defenseBonus', 'maxHpBonus', 'maxSpBonus', 'score'],
    numbers: ['attackBonus', 'defenseBonus', 'maxHpBonus', 'maxSpBonus', 'score']
  },
  lootTables: {
    required: ['lootTableId', 'dropType', 'dropId', 'weight', 'chance', 'minQuantity', 'maxQuantity'],
    numbers: ['weight', 'chance', 'minQuantity', 'maxQuantity']
  },
  scrolls: {
    required: ['scrollId', 'name', 'description', 'effectType', 'targetType', 'power', 'spCost', 'iconId', 'initialQuantity'],
    numbers: ['power', 'spCost', 'initialQuantity']
  },
  dungeons: {
    required: ['dungeonId', 'name', 'themeColor', 'enemyPool', 'floor1EnemyCount', 'floor2EnemyCount', 'bossEnemyId', 'difficultyScale'],
    numbers: ['floor1EnemyCount', 'floor2EnemyCount', 'difficultyScale'],
    lists: ['enemyPool']
  }
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV 結尾存在未關閉的雙引號');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }

  return rows;
}

function convertValue(value, field, schema) {
  if (schema.numbers?.includes(field)) return Number(value);
  if (schema.booleans?.includes(field)) return value.trim().toLowerCase() === 'true';
  if (schema.lists?.includes(field)) {
    return value.split('|').map((item) => item.trim()).filter(Boolean);
  }
  return value.trim();
}

function parseTable(name, text) {
  const schema = TABLE_SCHEMAS[name];
  if (!schema) throw new Error(`未知資料表：${name}`);

  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error(`${name} 沒有表頭`);

  const headers = rows[0].map((header) => header.trim());
  const missing = schema.required.filter((field) => !headers.includes(field));
  if (missing.length > 0) throw new Error(`${name} 缺少欄位：${missing.join(', ')}`);

  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`${name} 第 ${rowIndex + 2} 列欄位數為 ${values.length}，預期 ${headers.length}`);
    }
    return Object.fromEntries(headers.map((field, index) => [
      field,
      convertValue(values[index], field, schema)
    ]));
  });
}

async function fetchText(url, label) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${label} 無法連線：${url}（${error.message}）`);
  }
  if (!response.ok) throw new Error(`${label} 載入失敗：${url}（HTTP ${response.status}）`);
  return response.text();
}

function buildMap(rows, key, tableName, errors) {
  const map = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!id) errors.push(`${tableName} 存在空白 ${key}`);
    else if (map.has(id)) errors.push(`${tableName} 主鍵重複：${id}`);
    else map.set(id, row);
  }
  return map;
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

function parseBalance(rows, errors) {
  const balance = {};
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.key)) errors.push(`balance key 重複：${row.key}`);
    seen.add(row.key);

    if (row.type === 'number') {
      balance[row.key] = Number(row.value);
      if (Number.isNaN(balance[row.key])) errors.push(`balance.${row.key} 不是有效數字`);
    } else if (row.type === 'boolean') {
      balance[row.key] = row.value.trim().toLowerCase() === 'true';
    } else if (row.type === 'string') {
      balance[row.key] = row.value;
    } else {
      errors.push(`balance.${row.key} 使用未知 type：${row.type}`);
    }
  }
  return balance;
}

export function validateGameData(data) {
  const errors = [];
  const indexes = {};

  indexes.skillById = buildMap(data.skills, 'skillId', 'skills', errors);
  indexes.characterById = buildMap(data.characters, 'characterId', 'characters', errors);
  indexes.enemyById = buildMap(data.enemies, 'enemyId', 'enemies', errors);
  indexes.itemById = buildMap(data.items, 'itemId', 'items', errors);
  indexes.scrollById = buildMap(data.scrolls, 'scrollId', 'scrolls', errors);
  indexes.dungeonById = buildMap(data.dungeons, 'dungeonId', 'dungeons', errors);
  indexes.skillsByPool = groupBy(data.skills, 'skillPoolId');
  indexes.lootByTable = groupBy(data.lootTables, 'lootTableId');

  for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
    if (tableName === 'balance') continue;
    for (const row of data[tableName]) {
      for (const field of schema.numbers ?? []) {
        if (Number.isNaN(row[field])) errors.push(`${tableName}.${field} 不是有效數字`);
      }
    }
  }

  for (const character of data.characters) {
    if (!indexes.skillById.has(character.basicSkillId)) {
      errors.push(`characters.${character.characterId} 找不到 basicSkillId：${character.basicSkillId}`);
    }
    if (!indexes.skillsByPool.has(character.skillPoolId)) {
      errors.push(`characters.${character.characterId} 找不到 skillPoolId：${character.skillPoolId}`);
    }
  }

  for (const enemy of data.enemies) {
    if (!indexes.lootByTable.has(enemy.lootTableId)) {
      errors.push(`enemies.${enemy.enemyId} 找不到 lootTableId：${enemy.lootTableId}`);
    }
  }

  for (const loot of data.lootTables) {
    if (loot.chance < 0 || loot.chance > 1) {
      errors.push(`loot_tables.${loot.lootTableId} chance 超出 0–1：${loot.chance}`);
    }
    if (loot.minQuantity > loot.maxQuantity) {
      errors.push(`loot_tables.${loot.lootTableId} minQuantity 大於 maxQuantity`);
    }
    if (loot.dropType === 'item' && !indexes.itemById.has(loot.dropId)) {
      errors.push(`loot_tables 找不到 item：${loot.dropId}`);
    } else if (loot.dropType === 'scroll' && !indexes.scrollById.has(loot.dropId)) {
      errors.push(`loot_tables 找不到 scroll：${loot.dropId}`);
    } else if (!['item', 'scroll'].includes(loot.dropType)) {
      errors.push(`loot_tables 使用未知 dropType：${loot.dropType}`);
    }
  }

  for (const dungeon of data.dungeons) {
    for (const enemyId of dungeon.enemyPool) {
      if (!indexes.enemyById.has(enemyId)) errors.push(`dungeons.${dungeon.dungeonId} 找不到 enemyPool 成員：${enemyId}`);
    }
    const boss = indexes.enemyById.get(dungeon.bossEnemyId);
    if (!boss) errors.push(`dungeons.${dungeon.dungeonId} 找不到 bossEnemyId：${dungeon.bossEnemyId}`);
    else if (!boss.isBoss) errors.push(`dungeons.${dungeon.dungeonId} 的 Boss 未標記 isBoss=true`);
  }

  if (errors.length > 0) throw new Error(`遊戲資料驗證失敗：\n- ${errors.join('\n- ')}`);
  return indexes;
}

export async function loadGameData(manifestUrl = 'data/manifest.json') {
  const fallbackBase = /^https?:\/\//i.test(manifestUrl)
    ? new URL('/', manifestUrl).href
    : 'http://localhost/';
  const pageBase = globalThis.document?.baseURI ?? fallbackBase;
  const resolvedManifestUrl = new URL(manifestUrl, pageBase).href;
  const manifestText = await fetchText(resolvedManifestUrl, 'Manifest');
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Manifest JSON 格式錯誤：${resolvedManifestUrl}（${error.message}）`);
  }

  const tableNames = Object.keys(TABLE_SCHEMAS);
  const missingTables = tableNames.filter((name) => !manifest.tables?.[name]);
  if (missingTables.length > 0) throw new Error(`Manifest 缺少資料表：${missingTables.join(', ')}`);

  const entries = await Promise.all(tableNames.map(async (name) => {
    const url = new URL(manifest.tables[name], pageBase).href;
    const text = await fetchText(url, `資料表 ${name}`);
    return [name, parseTable(name, text)];
  }));
  const raw = Object.fromEntries(entries);
  const preValidationErrors = [];
  const balance = parseBalance(raw.balance, preValidationErrors);
  if (preValidationErrors.length > 0) throw new Error(preValidationErrors.join('\n'));

  const data = {
    manifest,
    raw,
    balance,
    characters: raw.characters,
    skills: raw.skills,
    enemies: raw.enemies,
    items: raw.items,
    lootTables: raw.lootTables,
    scrolls: raw.scrolls,
    dungeons: raw.dungeons
  };
  data.indexes = validateGameData(data);
  return data;
}
