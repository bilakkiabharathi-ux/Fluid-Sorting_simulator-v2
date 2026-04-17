(() => {
  // âââ DOM Elements âââ
  const screenMenu = document.getElementById('screen-menu');
  const screenGame = document.getElementById('screen-game');
  const screenResults = document.getElementById('screen-results');
  const screenHistory = document.getElementById('screen-history');
  const serialStatusWeb = document.getElementById('serial-status-web');
  const btnConnectSerial = document.getElementById('btn-connect-serial');
  const conveyorTrack = document.getElementById('conveyor-track');
  const hudLevel = document.getElementById('hud-level');
  const hudProgress = document.getElementById('hud-progress');
  const hudStatus = document.getElementById('hud-status');
  const hudTimer = document.getElementById('hud-timer');
  const btnPick = document.getElementById('btn-pick');
  const btnRestart = document.getElementById('btn-restart');
  const btnHistory = document.getElementById('btn-history');
  const btnBackToMenu = document.getElementById('btn-back-to-menu');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const historyContent = document.getElementById('history-content');

  // âââ Web Serial API Variables âââ
  let serialPort = null;
  let serialReader = null;
  let serialConnected = false;

  // âââ Game State âââ
  let config = null;
  let gameImages = [];
  let currentIndex = 0;
  let level = 1;
  let speedSec = 10;
  let isPicked = false;
  let pickedLabel = null;
  let animationId = null;
  let conveyorX = 0;
  let lastTimestamp = 0;
  let paused = false;
  let gameStartTime = 0;
  let gameEndTime = 0;
  let results = [];
  let spilloverChecked = new Set();
  let gameHistory = JSON.parse(localStorage.getItem('fluidSortingHistory') || '[]');

  // âââ Constants âââ
  const LABEL_WIDTH = 800;
  const LABEL_GAP = 60;
  const LABEL_TOTAL = LABEL_WIDTH + LABEL_GAP;
  const PICK_ZONE_TOLERANCE = 800;

  // âââ Embedded Config (No Server Needed) âââ
  config = {
    "images": [
      { "file": "label_01.png", "node": 1 },
      { "file": "label_02.png", "node": 2 },
      { "file": "label_03.png", "node": 3 },
      { "file": "label_04.png", "node": 4 },
      { "file": "label_05.png", "node": 1 },
      { "file": "label_06.png", "node": 2 },
      { "file": "label_07.png", "node": null },
      { "file": "label_08.png", "node": 3 },
      { "file": "label_09.png", "node": null },
      { "file": "label_10.png", "node": 4 },
      { "file": "label_11.png", "node": 1 },
      { "file": "label_12.png", "node": null },
      { "file": "label_13.png", "node": 2 },
      { "file": "label_14.png", "node": 3 },
      { "file": "label_15.png", "node": null },
      { "file": "label_16.png", "node": 4 },
      { "file": "label_17.png", "node": 1 },
      { "file": "label_18.png", "node": null },
      { "file": "label_19.png", "node": 2 },
      { "file": "label_20.png", "node": 3 },
      { "file": "label_21.png", "node": 4 },
      { "file": "label_22.png", "node": null },
      { "file": "label_23.png", "node": 1 },
      { "file": "label_24.png", "node": null },
      { "file": "label_25.png", "node": 2 },
      { "file": "label_26.png", "node": 3 },
      { "file": "label_27.png", "node": null },
      { "file": "label_28.png", "node": 4 },
      { "file": "label_29.png", "node": 1 },
      { "file": "label_30.png", "node": null },
      { "file": "label_31.png", "node": 2 },
      { "file": "label_32.png", "node": null },
      { "file": "label_33.png", "node": 3 },
      { "file": "label_34.png", "node": null },
      { "file": "label_35.png", "node": 4 },
      { "file": "label_36.png", "node": null },
      { "file": "label_37.png", "node": null },
      { "file": "label_38.png", "node": null },
      { "file": "label_39.png", "node": 1 },
      { "file": "label_40.png", "node": null }
    ],
    "levels": {
      "1": { "name": "Easy", "speedSec": 10 },
      "2": { "name": "Medium", "speedSec": 7 },
      "3": { "name": "Hard", "speedSec": 5 },
      "4": { "name": "Expert", "speedSec": 3 }
    }
  };

  // âââ Web Serial API Functions âââ
  async function connectArduino() {
    if (!('serial' in navigator)) {
      alert('Web Serial API not supported. Use Chrome/Edge browser with HTTPS or localhost.');
      return;
    }

    try {
      // Request serial port
      serialPort = await navigator.serial.requestPort();
      
      // Open the port
      await serialPort.open({ 
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none'
      });

      console.log('â Arduino connected via Web Serial API');
      serialConnected = true;
      updateSerialStatus(true);

      // Start reading data
      startSerialReader();

    } catch (error) {
      console.error('â Serial connection failed:', error);
      updateSerialStatus(false, error.message);
    }
  }

  async function startSerialReader() {
    if (!serialPort || !serialPort.readable) return;

    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
    serialReader = textDecoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await serialReader.read();
        if (done) break;

        // Process Arduino data
        const lines = value.split('\n');
        lines.forEach(line => {
          const cmd = line.trim();
          if (cmd) {
            console.log('ð Arduino:', cmd);
            handleArduinoCommand(cmd);
          }
        });
      }
    } catch (error) {
      console.error('Serial read error:', error);
    } finally {
      serialReader.releaseLock();
    }
  }

  function handleArduinoCommand(cmd) {
    if (cmd === 'P') {
      doPick();
    } else if (['1', '2', '3', '4'].includes(cmd)) {
      doDrop(parseInt(cmd));
    } else if (cmd === 'READY') {
      console.log('ð¤ Arduino ready');
    }
  }

  async function disconnectArduino() {
    if (serialReader) {
      await serialReader.cancel();
      serialReader = null;
    }
    
    if (serialPort) {
      await serialPort.close();
      serialPort = null;
    }
    
    serialConnected = false;
    updateSerialStatus(false);
    console.log('ð´ Arduino disconnected');
  }

  function updateSerialStatus(connected, error = null) {
    if (connected) {
      serialStatusWeb.textContent = 'â Arduino Connected';
      serialStatusWeb.className = 'status-badge connected';
      btnConnectSerial.textContent = 'ð´ Disconnect Arduino';
    } else {
      serialStatusWeb.textContent = error ? `â Error: ${error}` : 'â Arduino Not Connected';
      serialStatusWeb.className = 'status-badge disconnected';
      btnConnectSerial.textContent = 'ð Connect Arduino';
    }
  }

  // âââ Screen Management âââ
  function showScreen(screen) {
    [screenMenu, screenGame, screenResults, screenHistory].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  // âââ Utility Functions âââ
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // âââ Game Functions âââ
  function buildConveyor() {
  conveyorTrack.innerHTML = '';
  gameImages.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'conveyor-label';
    div.dataset.index = idx;
    if (img.node === null) div.classList.add('irrelevant');

    // Create placeholder content
    const labelEl = document.createElement('div');
    labelEl.className = 'label-placeholder';
    
    const labelContent = document.createElement('div');
    labelContent.className = 'label-content';
    
    const labelTitle = document.createElement('div');
    labelTitle.className = 'label-title';
    labelTitle.textContent = img.file;
    
    const labelNode = document.createElement('div');
    labelNode.className = 'label-node';
    labelNode.textContent = `Node: ${img.node || 'N/A'}`;
    
    const labelType = document.createElement('div');
    labelType.className = 'label-type';
    labelType.textContent = img.node ? 'RELEVANT' : 'IGNORE';
    
    // Assemble the structure
    labelContent.appendChild(labelTitle);
    labelContent.appendChild(labelNode);
    labelContent.appendChild(labelType);
    labelEl.appendChild(labelContent);
    div.appendChild(labelEl);

    conveyorTrack.appendChild(div);
  });
}

  function getLabelInPickZone() {
    const conveyorRect = document.getElementById('conveyor').getBoundingClientRect();
    const centerX = conveyorRect.left + conveyorRect.width / 2;

    const labels = conveyorTrack.querySelectorAll('.conveyor-label');
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      const labelCenter = rect.left + rect.width / 2;
      if (Math.abs(labelCenter - centerX) < PICK_ZONE_TOLERANCE) {
        return label;
      }
    }
    return null;
  }

  function animate(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const delta = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (!paused) {
      const pxPerSec = LABEL_TOTAL / speedSec;
      conveyorX -= pxPerSec * delta;
      conveyorTrack.style.transform = `translateY(-50%) translateX(${conveyorX}px)`;

      updatePickZoneHighlight();
      checkSpillover();

      const totalWidth = gameImages.length * LABEL_TOTAL;
      if (Math.abs(conveyorX) > totalWidth + 300) {
        endGame();
        return;
      }
    }

    updateHUD();
    animationId = requestAnimationFrame(animate);
  }

  function updatePickZoneHighlight() {
    const labels = conveyorTrack.querySelectorAll('.conveyor-label');
    const conveyorRect = document.getElementById('conveyor').getBoundingClientRect();
    const centerX = conveyorRect.left + conveyorRect.width / 2;

    labels.forEach(label => {
      const rect = label.getBoundingClientRect();
      const labelCenter = rect.left + rect.width / 2;
      if (Math.abs(labelCenter - centerX) < PICK_ZONE_TOLERANCE && 
          !label.classList.contains('picked') && 
          !label.classList.contains('missed')) {
        label.classList.add('in-pick-zone');
      } else {
        label.classList.remove('in-pick-zone');
      }
    });
  }

  function checkSpillover() {
    const conveyorRect = document.getElementById('conveyor').getBoundingClientRect();
    const pickZoneRight = conveyorRect.left + conveyorRect.width / 2 + PICK_ZONE_TOLERANCE;

    const labels = conveyorTrack.querySelectorAll('.conveyor-label');
    labels.forEach(label => {
      const idx = parseInt(label.dataset.index);
      const img = gameImages[idx];
      const rect = label.getBoundingClientRect();

      if (rect.right < pickZoneRight - 200 && !spilloverChecked.has(idx)) {
        spilloverChecked.add(idx);

        if (img.node !== null && !label.classList.contains('picked')) {
          label.classList.add('missed');
          results.push({
            file: img.file,
            node: img.node,
            action: 'spillover',
            droppedNode: null
          });
        }
        if (img.node === null && !label.classList.contains('picked')) {
          results.push({
            file: img.file,
            node: null,
            action: 'ignored',
            droppedNode: null
          });
        }
      }
    });

    hudProgress.textContent = `${results.length} / ${gameImages.length}`;
  }

  function doPick() {
    if (isPicked) return;

    const label = getLabelInPickZone();
    if (!label) return;

    const idx = parseInt(label.dataset.index);
    const img = gameImages[idx];

    if (spilloverChecked.has(idx)) return;

    isPicked = true;
    paused = true;
    pickedLabel = { idx, img, element: label };
    spilloverChecked.add(idx);

    label.classList.add('picked');
    label.classList.remove('in-pick-zone');

    hudStatus.textContent = 'ð¦ PICKED â Drop to Node 1-4';
    hudStatus.className = 'status-picked';
  }

  function doDrop(node) {
    if (!isPicked || !pickedLabel) return;

    const img = pickedLabel.img;

    if (img.node === null) {
      results.push({
        file: img.file,
        node: null,
        action: 'falsepick',
        droppedNode: node
      });
      flashNode(node, 'wrong');
    } else if (img.node === node) {
      results.push({
        file: img.file,
        node: img.node,
        action: 'correct',
        droppedNode: node
      });
      flashNode(node, 'highlight');
    } else {
      results.push({
        file: img.file,
        node: img.node,
        action: 'missorted',
        droppedNode: node
      });
      flashNode(node, 'wrong');
    }

    isPicked = false;
    paused = false;
    pickedLabel = null;
    lastTimestamp = 0;

    hudStatus.textContent = 'WATCHING';
    hudStatus.className = 'status-idle';
    hudProgress.textContent = `${results.length} / ${gameImages.length}`;
  }

  function flashNode(node, cls) {
    const box = document.querySelector(`.node-box[data-node="${node}"]`);
    if (box) {
      box.classList.add(cls);
      setTimeout(() => box.classList.remove(cls), 800);
    }
  }

  function updateHUD() {
    hudTimer.textContent = `â± ${speedSec}s/label`;
  }

  function endGame() {
    if (animationId) cancelAnimationFrame(animationId);

    gameImages.forEach((img, idx) => {
      if (!spilloverChecked.has(idx)) {
        if (img.node !== null) {
          results.push({ file: img.file, node: img.node, action: 'spillover', droppedNode: null });
        } else {
          results.push({ file: img.file, node: null, action: 'ignored', droppedNode: null });
        }
      }
    });

    showResults();
  }

  // âââ History Functions âââ
  function saveGameToHistory() {
    const gameEndTime = Date.now();
    const totalTimeMs = gameEndTime - gameStartTime;
    const totalTimeSec = Math.round(totalTimeMs / 1000);
    
    const correct = results.filter(r => r.action === 'correct').length;
    const missorted = results.filter(r => r.action === 'missorted').length;
    const spillover = results.filter(r => r.action === 'spillover').length;
    const falsepick = results.filter(r => r.action === 'falsepick').length;
    const totalRelevant = gameImages.filter(i => i.node !== null).length;
    const accuracy = totalRelevant > 0 ? Math.round((correct / totalRelevant) * 100) : 0;
    
    const historyItem = {
      date: new Date().toLocaleString(),
      level: level,
      levelName: config.levels[level].name,
      totalTime: totalTimeSec,
      accuracy: accuracy,
      correct: correct,
      missorted: missorted,
      spillover: spillover,
      falsepick: falsepick,
      totalItems: gameImages.length
    };
    
    gameHistory.unshift(historyItem);
    if (gameHistory.length > 50) gameHistory.pop();
    localStorage.setItem('fluidSortingHistory', JSON.stringify(gameHistory));
  }

  function showHistoryScreen() {
    showScreen(screenHistory);
    renderHistory();
  }

  function renderHistory() {
    if (!historyContent) return;
    
    if (gameHistory.length === 0) {
      historyContent.innerHTML = '<div class="no-history"><p>No games played yet. Start playing to see your history!</p></div>';
      return;
    }
    
    const historyHTML = gameHistory.map(game => `
      <div class="history-item">
        <div class="history-item-header">
          <span class="history-date">${game.date}</span>
          <span class="history-level">${game.levelName}</span>
        </div>
        <div class="history-stats">
          <div class="history-stat">
            <div class="history-stat-value">${game.accuracy}%</div>
            <div class="history-stat-label">Accuracy</div>
          </div>
          <div class="history-stat">
            <div class="history-stat-value">${game.correct}</div>
            <div class="history-stat-label">Correct</div>
          </div>
          <div class="history-stat">
            <div class="history-stat-value">${Math.floor(game.totalTime / 60)}:${(game.totalTime % 60).toString().padStart(2, '0')}</div>
            <div class="history-stat-label">Time</div>
          </div>
          <div class="history-stat">
            <div class="history-stat-value">${game.totalItems}</div>
            <div class="history-stat-label">Items</div>
          </div>
        </div>
      </div>
    `).join('');
    
    historyContent.innerHTML = historyHTML;
  }

  function showResults() {
    saveGameToHistory(); // Save game to history
    
    gameEndTime = Date.now();
    const totalTimeMs = gameEndTime - gameStartTime;
    const totalTimeSec = Math.round(totalTimeMs / 1000);
    const minutes = Math.floor(totalTimeSec / 60);
    const seconds = totalTimeSec % 60;

    const correct = results.filter(r => r.action === 'correct').length;
    const missorted = results.filter(r => r.action === 'missorted').length;
    const spillover = results.filter(r => r.action === 'spillover').length;
    const falsepick = results.filter(r => r.action === 'falsepick').length;
    const ignored = results.filter(r => r.action === 'ignored').length;
    const totalRelevant = gameImages.filter(i => i.node !== null).length;

    document.getElementById('res-correct').textContent = correct;
    document.getElementById('res-missorted').textContent = missorted;
    document.getElementById('res-spillover').textContent = spillover;
    document.getElementById('res-falsepick').textContent = falsepick;
    document.getElementById('res-ignored').textContent = ignored;

    const accuracy = totalRelevant > 0 ? Math.round((correct / totalRelevant) * 100) : 0;
    const itemsPerMin = totalTimeSec > 0 ? Math.round((gameImages.length / totalTimeSec) * 60) : 0;

    document.getElementById('res-total-time').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('res-accuracy').textContent = accuracy + '%';
    document.getElementById('res-speed').textContent = itemsPerMin + ' items/min';

    const badge = document.getElementById('performance-badge');
    const badgeScore = document.getElementById('badge-score');
    
    if (accuracy >= 90) {
      badge.className = 'performance-badge excellent';
      badgeScore.textContent = 'Excellent';
    } else if (accuracy >= 75) {
      badge.className = 'performance-badge good';
      badgeScore.textContent = 'Good';
    } else if (accuracy >= 50) {
      badge.className = 'performance-badge average';
      badgeScore.textContent = 'Average';
    } else {
      badge.className = 'performance-badge poor';
      badgeScore.textContent = 'Needs Improvement';
    }

    showScreen(screenResults);
  }

  function startGame(selectedLevel) {
    level = selectedLevel;
    speedSec = config.levels[level].speedSec;

    gameImages = shuffle(config.images);
    currentIndex = 0;
    isPicked = false;
    pickedLabel = null;
    paused = false;
    conveyorX = window.innerWidth;
    lastTimestamp = 0;
    results = [];
    spilloverChecked = new Set();
    gameStartTime = Date.now();

    hudLevel.textContent = `Level: ${config.levels[level].name}`;
    hudProgress.textContent = `0 / ${gameImages.length}`;
    hudStatus.textContent = 'WATCHING';
    hudStatus.className = 'status-idle';

    buildConveyor();
    conveyorTrack.style.transform = `translateY(-50%) translateX(${conveyorX}px)`;

    showScreen(screenGame);

    setTimeout(() => {
      animationId = requestAnimationFrame(animate);
    }, 1000);
  }

  // âââ Event Listeners âââ
  btnConnectSerial.addEventListener('click', () => {
    if (serialConnected) {
      disconnectArduino();
    } else {
      connectArduino();
    }
  });

  document.querySelectorAll('.btn-level[data-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      startGame(parseInt(btn.dataset.level));
    });
  });

  btnRestart.addEventListener('click', () => {
    showScreen(screenMenu);
  });

  btnPick.addEventListener('click', () => doPick());

  document.querySelectorAll('.drop-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      doDrop(parseInt(btn.dataset.node));
    });
  });

  // History event listeners
  if (btnHistory) {
    btnHistory.addEventListener('click', (e) => {
      e.preventDefault();
      showHistoryScreen();
    });
  }

  if (btnBackToMenu) {
    btnBackToMenu.addEventListener('click', () => {
      showScreen(screenMenu);
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all game history?')) {
        gameHistory = [];
        localStorage.removeItem('fluidSortingHistory');
        showHistoryScreen();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      doPick();
    } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
      const node = parseInt(e.code.replace('Digit', ''));
      doDrop(node);
    }
  });

  // âââ Initialize âââ
  console.log('ð® Fluid Sorting Simulator initialized with Web Serial API');
  updateSerialStatus(false);

})();
