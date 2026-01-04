const TABLES_ENDPOINT = 'http://localhost:4100/api/tables'; // backend.js in this folder

const tableList = document.getElementById('table_list');
const openCount = document.getElementById('open_count');
const hostBtn = document.getElementById('host_btn');
const hostPanel = document.getElementById('host_panel');
const closePanel = document.getElementById('close_panel');
const cancelHost = document.getElementById('cancel_host');
const hostForm = document.getElementById('host_form');
const filterGame = document.getElementById('filter_game');
const filterCity = document.getElementById('filter_city');

let tables = [];

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await loadTables();
  renderTables();
});

function bindEvents() {
  hostBtn.addEventListener('click', openHostPanel);
  closePanel.addEventListener('click', closeHostPanel);
  cancelHost.addEventListener('click', closeHostPanel);
  hostPanel.addEventListener('click', (e) => {
    if (e.target === hostPanel) closeHostPanel();
  });
  hostForm.addEventListener('submit', onHostSubmit);
  filterGame.addEventListener('input', renderTables);
  filterCity.addEventListener('input', renderTables);
}

async function loadTables() {
  try {
    const res = await fetch(TABLES_ENDPOINT);
    if (!res.ok) throw new Error(`Failed to load (${res.status})`);
    tables = await res.json();
    if (!Array.isArray(tables)) tables = [];
  } catch (err) {
    console.warn('Falling back to sample tables; backend unreachable.', err);
    const today = new Date();
    const fmtDate = (d) => d.toISOString().slice(0, 10);
    tables = [
      {
        id: crypto.randomUUID(),
        game: 'Catan',
        host: 'Alex',
        city: 'Downtown cafe',
        date: fmtDate(today),
        time: '19:00',
        seats: 2,
        duration: 2,
        notes: 'Base game + Seafarers.',
      },
      {
        id: crypto.randomUUID(),
        game: 'Wingspan',
        host: 'Riley',
        city: 'Online',
        date: fmtDate(today),
        time: '20:00',
        seats: 3,
        duration: 1.5,
        notes: 'Using digital rules, voice chat.',
      },
      {
        id: crypto.randomUUID(),
        game: 'Root',
        host: 'Sam',
        city: 'Uptown boardgame bar',
        date: fmtDate(today),
        time: '18:30',
        seats: 1,
        duration: 3,
        notes: 'Learning game welcome.',
      },
    ];
  }
}

function renderTables() {
  const gFilter = filterGame.value.trim().toLowerCase();
  const cFilter = filterCity.value.trim().toLowerCase();
  const filtered = tables.filter((t) => {
    const matchesGame = !gFilter || t.game.toLowerCase().includes(gFilter);
    const matchesCity = !cFilter || (t.city || '').toLowerCase().includes(cFilter);
    return matchesGame && matchesCity;
  });

  openCount.textContent = filtered.length;
  tableList.innerHTML = '';
  if (!filtered.length) {
    tableList.innerHTML = '<p class="muted">No tables found. Try another filter or host one.</p>';
    return;
  }

  filtered.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'table-card';
    card.innerHTML = `
      <header>
        <div>
          <h4>${t.game}</h4>
          <div class="meta">Hosted by ${t.host}</div>
        </div>
        <span class="pill">${t.seats} seats</span>
      </header>
      <div class="meta">${t.city || 'TBD'} • ${t.date} at ${t.time} • ${t.duration}h</div>
      <div class="footer">
        ${t.notes ? `<span class="pill alt">${t.notes}</span>` : ''}
      </div>
    `;
    tableList.appendChild(card);
  });
}

function openHostPanel() {
  hostPanel.classList.remove('hidden');
}

function closeHostPanel() {
  hostPanel.classList.add('hidden');
}

function onHostSubmit(event) {
  event.preventDefault();
  const form = hostForm.elements;
  const entry = {
    id: crypto.randomUUID(),
    game: form.game_name.value.trim(),
    host: form.host_name.value.trim() || 'Host',
    city: form.city.value.trim(),
    date: form.date.value,
    time: form.time.value,
    seats: parseInt(form.seats.value, 10) || 0,
    duration: parseFloat(form.duration.value) || 0,
    notes: form.notes.value.trim(),
  };
  if (!entry.game || !entry.date || !entry.time || entry.seats <= 0) {
    alert('Please fill game, date, time, and seats.');
    return;
  }
  saveTable(entry);
}

async function saveTable(entry) {
  try {
    const res = await fetch(TABLES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`Failed to save (${res.status})`);
    const saved = await res.json();
    tables.unshift(saved);
  } catch (err) {
    console.warn('Could not save to backend; keeping locally.', err);
    tables.unshift(entry);
  }
  hostForm.reset();
  closeHostPanel();
  renderTables();
}
