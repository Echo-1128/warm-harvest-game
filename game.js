/**
 * 暖禾农场基础版
 * 数据、渲染与交互刻意分区，方便未来接入天气、动物、钓鱼和联机同步。
 */
(() => {
  "use strict";

  const TILE = 32;
  const MAP_SIZE = 20;
  const SAVE_KEY = "warm-harvest-save-v1";

  const CROPS = {
    potato: { name: "土豆", icon: "🥔", seedIcon: "🫘", days: 3, seedPrice: 30, sellPrice: 60, colors: ["#9aba4c", "#6e9a3f", "#477633"] },
    carrot: { name: "胡萝卜", icon: "🥕", seedIcon: "🌰", days: 5, seedPrice: 50, sellPrice: 110, colors: ["#9fbd49", "#6f9f3f", "#e8782f"] },
    strawberry: { name: "草莓", icon: "🍓", seedIcon: "🌱", days: 8, seedPrice: 90, sellPrice: 220, colors: ["#8caf42", "#4f8739", "#d84a42"] }
  };

  const TOOLS = [
    { id: "hoe", name: "锄头", icon: "⛏️", tip: "翻耕空地" },
    { id: "water", name: "水壶", icon: "🪣", tip: "给耕地浇水" },
    { id: "sickle", name: "镰刀", icon: "🌙", tip: "收获成熟作物" },
    { id: "fertilizer", name: "肥料", icon: "🧺", tip: "减少 1 天生长并提高售价", count: "fertilizer" },
    { id: "potato", name: "土豆种子", icon: "🫘", tip: "3 天成熟", count: "seeds" },
    { id: "carrot", name: "胡萝卜种子", icon: "🌰", tip: "5 天成熟", count: "seeds" },
    { id: "strawberry", name: "草莓种子", icon: "🌱", tip: "8 天成熟", count: "seeds" },
    { id: "hand", name: "查看", icon: "🖐️", tip: "查看土地状态" }
  ];

  const BUILDINGS = [
    { id: "house", name: "木屋", x: 1, y: 1, w: 5, h: 4, color: "#a85f34", roof: "#355f5b" },
    { id: "shop", name: "麦穗商店", x: 14, y: 1, w: 5, h: 4, color: "#d28a3f", roof: "#8b4a32" },
    { id: "warehouse", name: "仓库", x: 14, y: 14, w: 5, h: 4, color: "#8f5938", roof: "#4b5a48" }
  ];

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const ui = {
    start: document.querySelector("#start-screen"),
    game: document.querySelector("#game-screen"),
    date: document.querySelector("#date-label"),
    time: document.querySelector("#time-label"),
    coins: document.querySelector("#coins-label"),
    energy: document.querySelector("#energy-label"),
    energyBar: document.querySelector("#energy-bar"),
    inventory: document.querySelector("#inventory-list"),
    toolbar: document.querySelector("#toolbar"),
    selected: document.querySelector("#selected-info"),
    toast: document.querySelector("#toast"),
    night: document.querySelector("#night-overlay"),
    sleep: document.querySelector("#sleep-btn"),
    guide: document.querySelector("#crop-guide"),
    backdrop: document.querySelector("#modal-backdrop"),
    shop: document.querySelector("#shop-modal"),
    help: document.querySelector("#help-modal"),
    event: document.querySelector("#event-modal"),
    shopItems: document.querySelector("#shop-items"),
    shopCoins: document.querySelector("#shop-coins"),
    eventText: document.querySelector("#event-text"),
    continueBtn: document.querySelector("#continue-btn")
  };

  let state;
  let selectedTool = 0;
  let keys = {};
  let lastFrame = performance.now();
  let toastTimer;
  let shopTab = "buy";
  let audioEnabled = true;
  let audioContext;

  function freshState() {
    return {
      day: 1,
      minutes: 360,
      coins: 500,
      energy: 100,
      player: { x: 9.5 * TILE, y: 10 * TILE, dir: "down", step: 0 },
      inventory: {
        fertilizer: 3,
        seeds: { potato: 6, carrot: 4, strawberry: 2 },
        harvest: { potato: 0, carrot: 0, strawberry: 0 },
        premiumHarvest: { potato: 0, carrot: 0, strawberry: 0 }
      },
      tiles: Array.from({ length: MAP_SIZE * MAP_SIZE }, () => ({
        tilled: false, watered: false, fertilized: false, crop: null
      })),
      stats: { harvested: 0, earned: 0 }
    };
  }

  function tileAt(x, y) {
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return null;
    return state.tiles[y * MAP_SIZE + x];
  }

  function startGame(load = false) {
    state = load ? loadState() : freshState();
    if (!state) state = freshState();
    // 兼容早期基础版存档。
    state.inventory.premiumHarvest ??= { potato: 0, carrot: 0, strawberry: 0 };
    selectedTool = 0;
    ui.start.classList.remove("active");
    ui.game.classList.add("active");
    updateUI();
    saveState();
    lastFrame = performance.now();
    requestAnimationFrame(loop);
    showToast("欢迎来到暖禾农场！先用锄头翻一块地吧。");
  }

  function saveState() {
    if (state) localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
    catch { return null; }
  }

  function isBuildingTile(tx, ty) {
    return BUILDINGS.some(b => tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h);
  }

  function canWalk(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    return tx >= 0 && ty >= 0 && tx < MAP_SIZE && ty < MAP_SIZE && !isBuildingTile(tx, ty);
  }

  function loop(now) {
    if (!ui.game.classList.contains("active")) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    update(dt);
    render(now);
    requestAnimationFrame(loop);
  }

  function update(dt) {
    if (ui.backdrop.classList.contains("open")) return;
    const p = state.player;
    const speed = 112;
    let dx = 0, dy = 0;
    if (keys.w || keys.arrowup) { dy--; p.dir = "up"; }
    if (keys.s || keys.arrowdown) { dy++; p.dir = "down"; }
    if (keys.a || keys.arrowleft) { dx--; p.dir = "left"; }
    if (keys.d || keys.arrowright) { dx++; p.dir = "right"; }
    if (dx && dy) { dx *= .707; dy *= .707; }
    if (dx || dy) {
      const nx = p.x + dx * speed * dt;
      const ny = p.y + dy * speed * dt;
      if (canWalk(nx, p.y)) p.x = nx;
      if (canWalk(p.x, ny)) p.y = ny;
      p.step += dt * 8;
    }

    state.minutes = Math.min(1439, state.minutes + dt * 1.8);
    const hour = Math.floor(state.minutes / 60);
    ui.night.style.opacity = String(Math.max(0, Math.min(.58, (hour - 17) * .1)));
    if (hour >= 23) sleep();

    const nearHouse = distanceToRect(p.x / TILE, p.y / TILE, BUILDINGS[0]) < 1.6;
    ui.sleep.classList.toggle("show", nearHouse);
    updateClockOnly();
  }

  function distanceToRect(x, y, r) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

  function render(now) {
    drawGround();
    drawFarmTiles(now);
    drawDecor();
    BUILDINGS.forEach(drawBuilding);
    drawPlayer(now);
  }

  function drawGround() {
    ctx.fillStyle = "#507d3f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const n = (x * 31 + y * 17) % 11;
        ctx.fillStyle = n < 2 ? "#5c8846" : n === 3 ? "#46713b" : "#507d3f";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        if (n === 1) {
          ctx.fillStyle = "#8eb454";
          ctx.fillRect(x * TILE + 6, y * TILE + 8, 3, 5);
          ctx.fillRect(x * TILE + 11, y * TILE + 11, 2, 4);
        }
      }
    }
    // 主路
    ctx.fillStyle = "#b98a4e";
    ctx.fillRect(0, 6 * TILE, 20 * TILE, 2 * TILE);
    ctx.fillRect(6 * TILE, 0, 2 * TILE, 8 * TILE);
    for (let i = 0; i < 34; i++) {
      const x = (i * 83) % 640, y = 194 + ((i * 37) % 54);
      ctx.fillStyle = i % 2 ? "#9f7042" : "#c99a5c";
      ctx.fillRect(x, y, 5, 3);
    }
  }

  function drawFarmTiles(now) {
    for (let y = 8; y < 19; y++) {
      for (let x = 1; x < 14; x++) {
        const tile = tileAt(x, y);
        if (!tile.tilled) continue;
        const px = x * TILE, py = y * TILE;
        ctx.fillStyle = tile.watered ? "#5d5360" : "#83502f";
        ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = tile.watered ? "#756878" : "#a36a3a";
        for (let r = 0; r < 3; r++) ctx.fillRect(px + 5, py + 7 + r * 8, 22, 2);
        if (tile.fertilized) {
          ctx.fillStyle = "#d6ad49";
          ctx.fillRect(px + 5, py + 4, 3, 3);
          ctx.fillRect(px + 23, py + 15, 3, 3);
        }
        if (tile.crop) drawCrop(px, py, tile.crop, now);
      }
    }
  }

  function drawCrop(px, py, crop, now) {
    const def = CROPS[crop.type];
    const need = Math.max(1, def.days - (crop.fertilized ? 1 : 0));
    const ratio = Math.min(1, crop.age / need);
    const stage = Math.min(3, Math.floor(ratio * 4));
    const sway = Math.round(Math.sin(now / 300 + px) * (stage >= 2 ? 1 : 0));
    ctx.fillStyle = "#315a32";
    ctx.fillRect(px + 15, py + 19 - stage * 3, 3, 10 + stage * 3);
    ctx.fillStyle = def.colors[Math.min(stage, 2)];
    const size = 5 + stage * 2;
    ctx.fillRect(px + 13 - size + sway, py + 17 - stage * 3, size, size);
    ctx.fillRect(px + 18 + sway, py + 15 - stage * 3, size, size);
    if (ratio >= 1) {
      ctx.fillStyle = def.colors[2];
      ctx.fillRect(px + 11 + sway, py + 20, 11, 8);
      if (crop.type === "strawberry") {
        ctx.fillStyle = "#f5c766";
        ctx.fillRect(px + 13, py + 22, 2, 2);
        ctx.fillRect(px + 19, py + 24, 2, 2);
      }
    }
  }

  function drawDecor() {
    // 围栏勾勒农田边界
    ctx.fillStyle = "#70452c";
    for (let x = 0; x < 14; x++) {
      ctx.fillRect(x * TILE + 3, 7 * TILE + 26, 27, 5);
      ctx.fillRect(x * TILE + 8, 7 * TILE + 20, 5, 14);
    }
    // 池塘
    ctx.fillStyle = "#396b71";
    ctx.fillRect(15 * TILE, 9 * TILE, 4 * TILE, 3 * TILE);
    ctx.fillStyle = "#5f9690";
    ctx.fillRect(15 * TILE + 6, 9 * TILE + 7, 3 * TILE + 20, 2 * TILE + 12);
    ctx.fillStyle = "#b2c368";
    ctx.fillRect(16 * TILE, 10 * TILE, 14, 7);
    ctx.fillRect(18 * TILE, 11 * TILE, 12, 6);
    // 树
    [[0,0],[8,0],[10,1],[19,7],[0,16],[12,19],[19,19]].forEach(([x,y]) => {
      ctx.fillStyle = "#493c2b"; ctx.fillRect(x*TILE+13,y*TILE+16,8,16);
      ctx.fillStyle = "#27563b"; ctx.fillRect(x*TILE+3,y*TILE+2,27,22);
      ctx.fillStyle = "#3f7644"; ctx.fillRect(x*TILE+8,y*TILE,18,17);
    });
  }

  function drawBuilding(b) {
    const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    ctx.fillStyle = "rgba(38,36,28,.25)";
    ctx.fillRect(x + 8, y + 13, w, h);
    ctx.fillStyle = b.color;
    ctx.fillRect(x + 6, y + 39, w - 12, h - 39);
    for (let i = 0; i < b.h - 1; i++) {
      ctx.fillStyle = i % 2 ? "rgba(255,211,117,.12)" : "rgba(65,33,22,.12)";
      ctx.fillRect(x + 8, y + 44 + i * 19, w - 16, 4);
    }
    ctx.fillStyle = b.roof;
    ctx.beginPath();
    ctx.moveTo(x, y + 45); ctx.lineTo(x + w / 2, y + 3); ctx.lineTo(x + w, y + 45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#233b38";
    for (let r = 0; r < 4; r++) ctx.fillRect(x + 12 + r * 28, y + 24 + (r % 2) * 5, 23, 5);
    ctx.fillStyle = "#5d3829";
    ctx.fillRect(x + w / 2 - 14, y + h - 50, 28, 50);
    ctx.fillStyle = "#e7a94d";
    ctx.fillRect(x + w / 2 + 6, y + h - 27, 4, 4);
    ctx.fillStyle = "#84bbbd";
    ctx.fillRect(x + 18, y + 59, 24, 23);
    ctx.fillStyle = "#4a3628";
    ctx.fillRect(x + 28, y + 59, 3, 23);
    ctx.fillRect(x + 18, y + 69, 24, 3);
    ctx.fillStyle = "#ffe3a0";
    ctx.fillRect(x + 10, y + h + 3, w - 20, 20);
    ctx.fillStyle = "#68412c";
    ctx.fillRect(x + 14, y + h + 7, w - 28, 12);
    ctx.fillStyle = "#fff0ba";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(b.name, x + w / 2, y + h + 17);
  }

  function drawPlayer(now) {
    const p = state.player;
    const walking = Object.values(keys).some(Boolean);
    const bob = walking ? Math.sin(p.step * Math.PI) * 2 : Math.sin(now / 450) * .5;
    const x = Math.round(p.x), y = Math.round(p.y + bob);
    ctx.fillStyle = "rgba(28,35,27,.32)";
    ctx.fillRect(x - 10, y + 13, 22, 7);
    ctx.fillStyle = "#efb063";
    ctx.fillRect(x - 7, y - 13, 15, 13);
    ctx.fillStyle = "#4b3024";
    ctx.fillRect(x - 9, y - 16, 19, 7);
    ctx.fillRect(x - 10, y - 11, 5, 8);
    ctx.fillStyle = "#315b57";
    ctx.fillRect(x - 8, y, 17, 15);
    ctx.fillStyle = "#d57b3c";
    ctx.fillRect(x - 11, y + 1, 4, 11);
    ctx.fillStyle = "#3e342d";
    ctx.fillRect(x - 7, y + 14, 5, 7);
    ctx.fillRect(x + 4, y + 14, 5, 7);
    ctx.fillStyle = "#31251f";
    const eyeX = p.dir === "left" ? x - 5 : p.dir === "right" ? x + 5 : x;
    if (p.dir !== "up") ctx.fillRect(eyeX, y - 8, 2, 2);
  }

  function interactAt(tx, ty) {
    if (ui.backdrop.classList.contains("open")) return;
    const ptx = state.player.x / TILE, pty = state.player.y / TILE;
    const building = BUILDINGS.find(b => tx >= b.x && tx < b.x+b.w && ty >= b.y && ty < b.y+b.h);
    if (building) {
      if (distanceToRect(ptx, pty, building) > 2) return showToast("走近一点再互动。");
      if (building.id === "shop") return openModal("shop");
      if (building.id === "house") return showToast("这是你温暖的小木屋。走到门口可以睡觉。");
      return showToast("仓库里还空着，未来可以存放动物饲料和材料。");
    }

    if (Math.hypot(tx + .5 - ptx, ty + .5 - pty) > 2.25) return showToast("这块地太远了。");
    if (tx < 1 || tx > 13 || ty < 8 || ty > 18) return showToast("这里不适合耕种。");

    const tile = tileAt(tx, ty);
    const tool = TOOLS[selectedTool];
    if (!useEnergy(tool.id === "hand" ? 0 : 2)) return;

    if (tool.id === "hoe") {
      if (tile.crop) return showToast("这里已经种了作物。");
      tile.tilled = true;
      beep(130);
      showToast("土地翻好了。");
    } else if (tool.id === "water") {
      if (!tile.tilled) return refundEnergy(2, "要先用锄头翻地。");
      tile.watered = true;
      beep(260);
      showToast("土地喝饱了水。");
    } else if (tool.id === "fertilizer") {
      if (!tile.tilled || tile.fertilized) return refundEnergy(2, "肥料只能撒在未施肥的耕地上。");
      if (state.inventory.fertilizer <= 0) return refundEnergy(2, "肥料用完了，去商店看看吧。");
      state.inventory.fertilizer--;
      tile.fertilized = true;
      if (tile.crop) tile.crop.fertilized = true;
      beep(350);
      showToast("土地变得更加肥沃了！");
    } else if (CROPS[tool.id]) {
      if (!tile.tilled) return refundEnergy(2, "先翻地，再播种。");
      if (tile.crop) return refundEnergy(2, "这里已经有作物了。");
      if (state.inventory.seeds[tool.id] <= 0) return refundEnergy(2, "这种种子用完了。");
      state.inventory.seeds[tool.id]--;
      tile.crop = { type: tool.id, age: 0, fertilized: tile.fertilized };
      beep(310);
      showToast(`种下了${CROPS[tool.id].name}种子。`);
    } else if (tool.id === "sickle") {
      if (!tile.crop) return refundEnergy(2, "这里没有可以收获的作物。");
      const def = CROPS[tile.crop.type];
      const need = Math.max(1, def.days - (tile.crop.fertilized ? 1 : 0));
      if (tile.crop.age < need) return refundEnergy(2, `${def.name}还没有成熟。`);
      state.inventory.harvest[tile.crop.type]++;
      if (tile.crop.fertilized) state.inventory.premiumHarvest[tile.crop.type]++;
      state.stats.harvested++;
      tile.crop = null;
      tile.watered = false;
      beep(520);
      showToast(`收获了 1 个${def.name}！`);
    } else {
      if (!tile.tilled) showToast("一块普通的草地。");
      else if (!tile.crop) showToast(`空耕地 · ${tile.watered ? "已浇水" : "干燥"}${tile.fertilized ? " · 已施肥" : ""}`);
      else {
        const def = CROPS[tile.crop.type];
        const need = Math.max(1, def.days - (tile.crop.fertilized ? 1 : 0));
        showToast(`${def.name} · ${tile.crop.age >= need ? "已经成熟！" : `还需 ${need - tile.crop.age} 天`}`);
      }
    }
    updateUI();
    saveState();
  }

  function useEnergy(amount) {
    if (state.energy < amount) {
      showToast("太累了，回木屋睡一觉吧。");
      return false;
    }
    state.energy -= amount;
    return true;
  }

  function refundEnergy(amount, message) {
    state.energy = Math.min(100, state.energy + amount);
    showToast(message);
  }

  function sleep() {
    if (!state || ui.backdrop.classList.contains("open")) return;
    let grew = 0;
    state.tiles.forEach(tile => {
      if (tile.crop && tile.watered) {
        tile.crop.age++;
        grew++;
      }
      tile.watered = false;
    });

    const stolen = [];
    if (Math.random() < .10) {
      const mature = state.tiles.filter(tile => {
        if (!tile.crop) return false;
        const def = CROPS[tile.crop.type];
        return tile.crop.age >= Math.max(1, def.days - (tile.crop.fertilized ? 1 : 0));
      });
      const amount = Math.min(mature.length, 1 + Math.floor(Math.random() * 3));
      for (let i = 0; i < amount; i++) {
        const index = Math.floor(Math.random() * mature.length);
        const [victim] = mature.splice(index, 1);
        stolen.push(CROPS[victim.crop.type].name);
        victim.crop = null;
      }
    }

    state.day++;
    state.minutes = 360;
    state.energy = 100;
    state.player.x = 6.5 * TILE;
    state.player.y = 6.7 * TILE;
    updateUI();
    saveState();
    showToast(`第 ${state.day} 天开始了。${grew ? `${grew} 株作物长大了一些。` : "记得每天浇水。"}`);
    if (stolen.length) {
      ui.eventText.textContent = `被偷走了 ${stolen.length} 个成熟作物：${stolen.join("、")}。以后可以修建围栏降低风险。`;
      setTimeout(() => openModal("event"), 350);
    }
  }

  function updateClockOnly() {
    const h = Math.floor(state.minutes / 60);
    const m = Math.floor(state.minutes % 60 / 10) * 10;
    ui.time.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }

  function updateUI() {
    ui.date.textContent = `春季 ${state.day} 日`;
    updateClockOnly();
    ui.coins.textContent = state.coins;
    ui.shopCoins.textContent = state.coins;
    ui.energy.textContent = Math.round(state.energy);
    ui.energyBar.style.width = `${state.energy}%`;
    ui.energyBar.style.background = state.energy < 25 ? "#d35d47" : "#71b95b";

    ui.inventory.innerHTML = [
      ["🧺", "肥料", state.inventory.fertilizer],
      ["🫘", "土豆种子", state.inventory.seeds.potato],
      ["🌰", "胡萝卜种子", state.inventory.seeds.carrot],
      ["🌱", "草莓种子", state.inventory.seeds.strawberry],
      ["🥔", "土豆", state.inventory.harvest.potato, state.inventory.premiumHarvest.potato],
      ["🥕", "胡萝卜", state.inventory.harvest.carrot, state.inventory.premiumHarvest.carrot],
      ["🍓", "草莓", state.inventory.harvest.strawberry, state.inventory.premiumHarvest.strawberry]
    ].map(([icon, name, count, premium = 0]) => `<div class="inventory-item"><span class="item-icon">${icon}</span><div><b>${name}</b><small>数量 ${count}${premium ? ` · 优质 ${premium}` : ""}</small></div></div>`).join("");

    ui.toolbar.innerHTML = TOOLS.map((tool, i) => {
      let count = "";
      if (tool.count === "fertilizer") count = state.inventory.fertilizer;
      if (tool.count === "seeds") count = state.inventory.seeds[tool.id];
      return `<button class="tool-slot ${i === selectedTool ? "active" : ""}" data-tool="${i}" title="${tool.name}">
        <span class="key">${i+1}</span><span class="tool-emoji">${tool.icon}</span><span class="count">${count}</span>
      </button>`;
    }).join("");
    const active = TOOLS[selectedTool];
    ui.selected.textContent = `${active.name} · ${active.tip}`;
  }

  function buildGuide() {
    ui.guide.innerHTML = Object.values(CROPS).map(c =>
      `<div class="crop-card"><span class="crop-icon">${c.icon}</span><div><b>${c.name}</b><small>${c.days} 天成熟 · 售价 ${c.sellPrice} 金</small></div></div>`
    ).join("");
  }

  function openModal(which) {
    ui.backdrop.classList.add("open");
    [ui.shop, ui.help, ui.event].forEach(m => m.classList.remove("active"));
    ui[which].classList.add("active");
    if (which === "shop") renderShop();
  }

  function closeModal() {
    ui.backdrop.classList.remove("open");
    [ui.shop, ui.help, ui.event].forEach(m => m.classList.remove("active"));
  }

  function renderShop() {
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === shopTab));
    ui.shopCoins.textContent = state.coins;
    if (shopTab === "buy") {
      const entries = [
        ...Object.entries(CROPS).map(([id, c]) => ({ id, icon: c.seedIcon, name: `${c.name}种子`, desc: `${c.days} 天成熟`, price: c.seedPrice })),
        { id: "fertilizer", icon: "🧺", name: "有机肥料", desc: "提速并提升售价", price: 45 }
      ];
      ui.shopItems.innerHTML = entries.map(e => `<div class="shop-row">
        <span class="big-icon">${e.icon}</span><div><b>${e.name}</b><small>${e.desc}</small></div>
        <strong>${e.price} 金</strong><button data-buy="${e.id}" ${state.coins < e.price ? "disabled" : ""}>购买</button>
      </div>`).join("");
    } else {
      ui.shopItems.innerHTML = Object.entries(CROPS).map(([id, c]) => {
        const count = state.inventory.harvest[id];
        const premium = state.inventory.premiumHarvest[id];
        const nextPrice = premium > 0 ? Math.round(c.sellPrice * 1.25) : c.sellPrice;
        return `<div class="shop-row"><span class="big-icon">${c.icon}</span><div><b>${c.name}</b><small>背包中有 ${count} 个</small></div>
          <strong>${nextPrice} 金${premium ? " ★" : ""}</strong><button data-sell="${id}" ${count <= 0 ? "disabled" : ""}>出售 1 个</button></div>`;
      }).join("");
    }
  }

  function buy(id) {
    const price = id === "fertilizer" ? 45 : CROPS[id].seedPrice;
    if (state.coins < price) return;
    state.coins -= price;
    if (id === "fertilizer") state.inventory.fertilizer++;
    else state.inventory.seeds[id]++;
    beep(440);
    updateUI(); renderShop(); saveState();
  }

  function sell(id) {
    if (state.inventory.harvest[id] <= 0) return;
    const premium = state.inventory.premiumHarvest[id] > 0;
    state.inventory.harvest[id]--;
    if (premium) state.inventory.premiumHarvest[id]--;
    const price = premium ? Math.round(CROPS[id].sellPrice * 1.25) : CROPS[id].sellPrice;
    state.coins += price;
    state.stats.earned += price;
    beep(620);
    updateUI(); renderShop(); saveState();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2300);
  }

  function beep(frequency) {
    if (!audioEnabled) return;
    try {
      audioContext ??= new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.035, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .08);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + .08);
    } catch {}
  }

  canvas.addEventListener("click", e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    interactAt(Math.floor((e.clientX - rect.left) * scaleX / TILE), Math.floor((e.clientY - rect.top) * scaleY / TILE));
  });

  window.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    keys[key] = true;
    if (key >= "1" && key <= "8") {
      selectedTool = Number(key) - 1;
      updateUI();
    }
    if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(key)) e.preventDefault();
  });
  window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener("blur", () => { keys = {}; });
  canvas.addEventListener("wheel", e => {
    selectedTool = (selectedTool + (e.deltaY > 0 ? 1 : TOOLS.length - 1)) % TOOLS.length;
    updateUI();
    e.preventDefault();
  }, { passive: false });

  ui.toolbar.addEventListener("click", e => {
    const slot = e.target.closest("[data-tool]");
    if (!slot) return;
    selectedTool = Number(slot.dataset.tool);
    updateUI();
  });
  document.querySelector("#start-btn").addEventListener("click", () => startGame(false));
  ui.continueBtn.addEventListener("click", () => startGame(true));
  document.querySelector("#help-btn").addEventListener("click", () => openModal("help"));
  document.querySelector("#sound-btn").addEventListener("click", e => {
    audioEnabled = !audioEnabled;
    e.currentTarget.textContent = audioEnabled ? "♪" : "×";
  });
  ui.sleep.addEventListener("click", sleep);
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
  ui.backdrop.addEventListener("click", e => { if (e.target === ui.backdrop) closeModal(); });
  document.querySelector(".shop-tabs").addEventListener("click", e => {
    if (!e.target.dataset.tab) return;
    shopTab = e.target.dataset.tab;
    renderShop();
  });
  ui.shopItems.addEventListener("click", e => {
    if (e.target.dataset.buy) buy(e.target.dataset.buy);
    if (e.target.dataset.sell) sell(e.target.dataset.sell);
  });

  // 手机触屏方向键：按住连续移动，松手立即停止。
  document.querySelectorAll("[data-move]").forEach(button => {
    const moveKey = button.dataset.move;
    const startMove = event => {
      event.preventDefault();
      keys[moveKey] = true;
      if (button.setPointerCapture && event.pointerId !== undefined) button.setPointerCapture(event.pointerId);
    };
    const stopMove = event => {
      event.preventDefault();
      keys[moveKey] = false;
    };
    button.addEventListener("pointerdown", startMove);
    button.addEventListener("pointerup", stopMove);
    button.addEventListener("pointercancel", stopMove);
    button.addEventListener("lostpointercapture", stopMove);
  });

  buildGuide();
  ui.continueBtn.style.display = localStorage.getItem(SAVE_KEY) ? "inline-block" : "none";
})();
