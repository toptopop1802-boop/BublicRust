// API Base URL (can be overridden via window.API_URL or ?api=...)
const API_URL = (function() {
    const qp = new URLSearchParams(window.location.search).get('api');
    if (typeof window.API_URL === 'string' && window.API_URL.trim()) return window.API_URL.trim();
    if (qp && qp.trim()) return qp.trim();
    return window.location.origin;
})();

// Global State
let chart = null;
let autoRefreshInterval = null;
let currentChartData = null;
let currentChartView = 'all';
// Demo
let demoChart = null;
let demoCurrentDays = 30;
let demoCurrentType = 'all';

// Utility: Format time
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}ч ${minutes}м ${secs}с`;
    } else if (minutes > 0) {
        return `${minutes}м ${secs}с`;
    } else {
        return `${secs}с`;
    }
}

// Utility: Show loader
function showLoader() {
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
}

// Utility: Hide loader
function hideLoader() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
}

// Utility: Update last update time
function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('last-update').textContent = now.toLocaleTimeString('ru-RU');
}

// Utility: HEX -> RGBA
function hexToRgba(hex, alpha = 1) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============================================
// ANALYTICS PAGE
// ============================================

async function loadAnalytics(days = 30) {
    try {
        const response = await fetch(`${API_URL}/api/stats?days=${days}`);
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Invalid response (status ${response.status}): ${text.slice(0, 120)}`);
        }
        const data = await response.json();

        // Update stats cards
        document.getElementById('stat-wipes').textContent = data.wipe_created || 0;
        document.getElementById('stat-tickets').textContent = data.ticket_created || 0;
        document.getElementById('stat-roles').textContent = data.tournament_role_created || 0;
        document.getElementById('stat-deleted').textContent = data.channel_deleted || 0;

        // Normalize timeline: fill missing days with zeros so the line is continuous
        let timelineNormalized = [];
        if (days === 1) {
            // Build minute buckets from start of today to now, set last point to today's totals
            const now = new Date();
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const minutes = Math.max(1, Math.floor((now - startOfDay) / 60000));
            for (let i = 0; i <= minutes; i++) {
                const dt = new Date(startOfDay.getTime() + i * 60000);
                timelineNormalized.push({
                    date: dt.toISOString(),
                    wipe_created: 0,
                    ticket_created: 0,
                    tournament_role_created: 0,
                    channel_deleted: 0
                });
            }
            // place today's totals at the last minute
            const last = timelineNormalized[timelineNormalized.length - 1];
            last.wipe_created = data.wipe_created || 0;
            last.ticket_created = data.ticket_created || 0;
            last.tournament_role_created = data.tournament_role_created || 0;
            last.channel_deleted = data.channel_deleted || 0;
        } else {
            const today = new Date();
            const start = new Date();
            start.setDate(today.getDate() - (days - 1));
            const byDate = new Map((data.timeline || []).map(t => [new Date(t.date).toISOString().split('T')[0], t]));

            for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
                const key = d.toISOString().split('T')[0];
                const t = byDate.get(key) || {
                    date: key,
                    wipe_created: 0,
                    ticket_created: 0,
                    tournament_role_created: 0,
                    channel_deleted: 0
                };
                timelineNormalized.push(t);
            }
        }

        // Store chart data and update
        currentChartData = timelineNormalized;
        updateChart(currentChartData, currentChartView);
        updateLastUpdateTime();
    } catch (error) {
        console.error('Error loading analytics:', error);
        // Fallback: render empty timeline for requested range so UI stays usable
        const timelineNormalized = [];
        if (days === 1) {
            const now = new Date();
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const minutes = Math.max(1, Math.floor((now - startOfDay) / 60000));
            for (let i = 0; i <= minutes; i++) {
                const dt = new Date(startOfDay.getTime() + i * 60000);
                timelineNormalized.push({
                    date: dt.toISOString(),
                    wipe_created: 0,
                    ticket_created: 0,
                    tournament_role_created: 0,
                    channel_deleted: 0
                });
            }
        } else {
            const today = new Date();
            const start = new Date();
            start.setDate(today.getDate() - (days - 1));
            for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
                const key = d.toISOString().split('T')[0];
                timelineNormalized.push({
                    date: key,
                    wipe_created: 0,
                    ticket_created: 0,
                    tournament_role_created: 0,
                    channel_deleted: 0
                });
            }
        }
        currentChartData = timelineNormalized;
        updateChart(currentChartData, currentChartView);
        updateLastUpdateTime();
    }
}

function updateChart(timeline, view = 'all') {
    const ctx = document.getElementById('activity-chart').getContext('2d');

    const firstDate = timeline.length ? new Date(timeline[0].date) : null;
    const lastDate = timeline.length ? new Date(timeline[timeline.length - 1].date) : null;
    const isSameDay = firstDate && lastDate && firstDate.toDateString() === lastDate.toDateString();

    const labels = timeline.map(t => {
        const date = new Date(t.date);
        return isSameDay
            ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    });

    let datasets = [];

    function getAccentRgba(alpha = 1) {
        const styles = getComputedStyle(document.documentElement);
        const hex = styles.getPropertyValue('--accent-primary').trim() || '#3b9bf9';
        return hexToRgba(hex, alpha);
    }

    function hexToRgba(hex, alpha = 1) {
        const h = hex.replace('#', '');
        const bigint = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function buildGradient(ctx, color) {
        const gradient = ctx.createLinearGradient(0, 0, 0, 220);
        gradient.addColorStop(0, color.replace('1)', '0.35)'));
        gradient.addColorStop(1, color.replace('1)', '0)'));
        return gradient;
    }

    if (view === 'all') {
        const total = timeline.map(t =>
            (t.wipe_created || 0) + (t.ticket_created || 0) + (t.tournament_role_created || 0) + (t.channel_deleted || 0)
        );
        datasets = [{
            label: 'Все события',
            data: total,
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
                fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#1D1D1D',
            spanGaps: true
        }];
    } else if (view === 'wipes') {
        datasets = [{
            label: 'Вайпы',
            data: timeline.map(t => t.wipe_created || 0),
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#1D1D1D',
            spanGaps: true
        }];
    } else if (view === 'tickets') {
        datasets = [{
            label: 'Тикеты',
            data: timeline.map(t => t.ticket_created || 0),
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#1D1D1D',
            spanGaps: true
        }];
    } else if (view === 'roles') {
        datasets = [{
            label: 'Роли',
            data: timeline.map(t => t.tournament_role_created || 0),
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#1D1D1D',
            spanGaps: true
        }];
    } else if (view === 'deleted') {
        datasets = [{
            label: 'Удалено каналов',
            data: timeline.map(t => t.channel_deleted || 0),
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#1D1D1D',
            spanGaps: true
        }];
    } else if (view === 'members') {
        datasets = [{
            label: 'Участники',
            data: timeline.map(t => t.member_count || 0),
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            pointBackgroundColor: '#1D1D1D',
            spanGaps: true
        }];
    }

    const maxValue = Math.max(1, ...datasets.flatMap(ds => ds.data));
    const stepSize = maxValue <= 10 ? 1 : undefined;

    if (chart) {
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.options.scales.y.ticks.stepSize = stepSize;
        chart.update('active');
    } else {
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2.2,
                animation: {
                    duration: 750,
                    easing: 'easeInOutQuart'
                },
                plugins: {
                    legend: {
                        display: view !== 'all',
                        position: 'top',
                        labels: {
                            color: '#a0a0a0',
                            usePointStyle: true,
                            pointStyle: 'line',
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: '#252525',
                        titleColor: '#ffffff',
                        bodyColor: '#a0a0a0',
                        borderColor: '#3a3a3a',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: '#3a3a3a',
                            display: false
                        },
                        ticks: {
                            color: '#a0a0a0'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#2b2b2b'
                        },
                        ticks: {
                            color: '#a0a0a0',
                            precision: 0,
                            stepSize
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }
}

// ============================================
// CHART TABS
// ============================================

function setupChartTabs() {
    document.querySelectorAll('.chart-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update chart
            currentChartView = tab.dataset.chart;
            if (currentChartData) {
                updateChart(currentChartData, currentChartView);
            }
        });
    });
}

// ============================================
// MESSAGES PAGE
// ============================================

async function loadGuilds() {
    try {
        const response = await fetch(`${API_URL}/api/guilds`);
        const guilds = await response.json();

        const select = document.getElementById('guild-select');
        select.innerHTML = '<option value="">Выберите сервер...</option>';
        
        guilds.forEach(guild => {
            const option = document.createElement('option');
            option.value = guild.id;
            option.textContent = `${guild.name} (${guild.memberCount} участников)`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading guilds:', error);
    }
}

async function loadChannels(guildId) {
    try {
        const response = await fetch(`${API_URL}/api/guilds/${guildId}/channels`);
        const channels = await response.json();

        const select = document.getElementById('channel-select');
        select.innerHTML = '<option value="">Выберите канал...</option>';
        select.disabled = false;
        
        channels.forEach(channel => {
            const option = document.createElement('option');
            option.value = channel.id;
            option.textContent = `# ${channel.name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

async function sendMessage(channelId, content) {
    try {
        const response = await fetch(`${API_URL}/api/send-message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ channelId, content })
        });

        const data = await response.json();

        const status = document.getElementById('message-status');
        if (data.success) {
            status.className = 'message-status success';
            status.textContent = '✅ Сообщение успешно отправлено!';
            document.getElementById('message-content').value = '';
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (error) {
        const status = document.getElementById('message-status');
        status.className = 'message-status error';
        status.textContent = `❌ Ошибка: ${error.message}`;
    }

    setTimeout(() => {
        document.getElementById('message-status').style.display = 'none';
    }, 5000);
}

async function readMessages(channelId) {
    try {
        const response = await fetch(`${API_URL}/api/channels/${channelId}/messages`);
        const messages = await response.json();

        const container = document.getElementById('messages-container');
        const messagesList = document.getElementById('messages-list');

        if (messages.length === 0) {
            messagesList.innerHTML = '<p style="color: #a0a0a0; text-align: center; padding: 20px;">Нет сообщений в этом канале</p>';
        } else {
            messagesList.innerHTML = messages.map(msg => {
                const date = new Date(msg.timestamp);
                const timeStr = date.toLocaleString('ru-RU');
                
                return `
                    <div class="message-item">
                        <div class="message-header">
                            <span class="message-author">${msg.author}</span>
                            <span class="message-time">${timeStr}</span>
                        </div>
                        <div class="message-content">${escapeHtml(msg.content)}</div>
                    </div>
                `;
            }).join('');
        }

        container.style.display = 'block';
    } catch (error) {
        console.error('Error reading messages:', error);
        alert(`Ошибка чтения сообщений: ${error.message}`);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// AUTO-DELETE CHANNELS PAGE
// ============================================

async function loadAutoDeleteChannels() {
    try {
        const response = await fetch(`${API_URL}/api/auto-delete-channels`);
        const channels = await response.json();

        const container = document.getElementById('channels-list');

        if (channels.length === 0) {
            container.innerHTML = '<p style="color: #a0a0a0; text-align: center; padding: 40px;">Нет каналов на автоудаление</p>';
            return;
        }

        container.innerHTML = channels.map(ch => {
            const timerClass = ch.time_left_seconds < 300 ? 'danger' : 
                              ch.time_left_seconds < 1800 ? 'warning' : '';
            
            return `
                <div class="channel-card">
                    <div class="channel-info">
                        <h4>Канал ID: ${ch.channel_id}</h4>
                        <p>Тип: ${ch.channel_type}</p>
                    </div>
                    <div class="channel-timer ${timerClass}">
                        ${formatTime(ch.time_left_seconds)}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading auto-delete channels:', error);
    }
}

// ============================================
// DEMO MODAL
// ============================================

function setupDemoModal() {
    const modal = document.getElementById('demo-modal');
    const demoBtn = document.getElementById('demo-btn');
    const closeBtn = document.getElementById('demo-modal-close');

    demoBtn.addEventListener('click', () => {
        modal.classList.add('active');
        // Render default demo view on open
        demoCurrentDays = 30;
        demoCurrentType = 'all';
        renderDemoChart(demoCurrentDays, demoCurrentType);
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        if (demoChart) {
            demoChart.destroy();
            demoChart = null;
        }
    });

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            if (demoChart) {
                demoChart.destroy();
                demoChart = null;
            }
        }
    });

    // Range tabs
    const rangeTabs = document.getElementById('demo-range-tabs');
    if (rangeTabs) {
        rangeTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.demo-range');
            if (!btn) return;
            rangeTabs.querySelectorAll('.demo-range').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            demoCurrentDays = parseInt(btn.dataset.days);
            renderDemoChart(demoCurrentDays, demoCurrentType);
        });
    }

    // Type tabs
    const typeTabs = document.getElementById('demo-type-tabs');
    if (typeTabs) {
        typeTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.demo-type');
            if (!btn) return;
            typeTabs.querySelectorAll('.demo-type').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            demoCurrentType = btn.dataset.type;
            renderDemoChart(demoCurrentDays, demoCurrentType);
        });
    }
}

// ============================================
// DEMO DATA / CHART
// ============================================

function seededRandom(seed) {
    let t = seed + 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function generateDemoData(days) {
    const now = new Date();
    const points = days === 1 ? 24 : days; // hourly for 1D, daily otherwise
    const labels = [];
    const series = {
        wipes: [],
        tickets: [],
        roles: [],
        deleted: []
    };

    for (let i = points - 1; i >= 0; i--) {
        const date = new Date(now);
        if (days === 1) {
            date.setHours(now.getHours() - i);
            labels.push(date.toLocaleTimeString('ru-RU', { hour: '2-digit' }));
        } else {
            date.setDate(now.getDate() - i);
            labels.push(date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }));
        }

        // nice wave-like shape with noise, different amplitudes
        const base = Math.sin((points - i) / points * Math.PI) * 10;
        const rnd1 = Math.floor(seededRandom(i * 17 + points) * 4);
        const rnd2 = Math.floor(seededRandom(i * 31 + points) * 3);

        series.wipes.push(Math.max(0, Math.round(base + 2 + rnd1)));
        series.tickets.push(Math.max(0, Math.round(base * 0.8 + 1 + rnd2)));
        series.roles.push(Math.max(0, Math.round(base * 0.6 + rnd1 % 2)));
        series.deleted.push(Math.max(0, Math.round(base * 0.5 + rnd2 % 2)));
    }

    return { labels, series };
}

function buildGradient(ctx, color) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, color.replace('1)', '0.35)'));
    gradient.addColorStop(1, color.replace('1)', '0)'));
    return gradient;
}

function renderDemoChart(days, type) {
    const canvas = document.getElementById('demo-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const { labels, series } = generateDemoData(days);

    function getAccentRgba(alpha = 1) {
        const styles = getComputedStyle(document.documentElement);
        const hex = styles.getPropertyValue('--accent-primary').trim() || '#3b9bf9';
        return hexToRgba(hex, alpha);
    }

    let datasets = [];
    if (type === 'all') {
        const total = series.wipes.map((_, idx) => series.wipes[idx] + series.tickets[idx] + series.roles[idx] + series.deleted[idx]);
        datasets = [{
            label: 'Все события',
            data: total,
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.35,
            borderWidth: 2
        }];
    } else {
        const map = { wipes: 'Вайпы', tickets: 'Тикеты', roles: 'Роли', deleted: 'Удаленные каналы' };
        datasets = [{
            label: map[type],
            data: series[type],
            borderColor: getAccentRgba(1),
            backgroundColor: buildGradient(ctx, getAccentRgba(1)),
            fill: true,
            tension: 0.35,
            borderWidth: 2
        }];
    }

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: 'easeInOutQuart' },
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: '#252525',
                titleColor: '#ffffff',
                bodyColor: '#a0a0a0',
                borderColor: '#3a3a3a',
                borderWidth: 1
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: '#a0a0a0', maxTicksLimit: days === 1 ? 8 : 10 }
            },
            y: {
                beginAtZero: true,
                grid: { color: '#2b2b2b' },
                ticks: { color: '#a0a0a0', precision: 0 }
            }
        }
    };

    if (demoChart) {
        demoChart.data.labels = labels;
        demoChart.data.datasets = datasets;
        demoChart.update('active');
    } else {
        demoChart = new Chart(ctx, { type: 'line', data: { labels, datasets }, options });
    }
}

// ============================================
// NAVIGATION
// ============================================

function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Update active link
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show corresponding page
            const page = link.dataset.page;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`page-${page}`).classList.add('active');

            // Load page data
            if (page === 'analytics') {
                const days = parseInt(document.getElementById('period-select').value);
                loadAnalytics(days);
            } else if (page === 'messages') {
                loadGuilds();
            } else if (page === 'channels') {
                loadAutoDeleteChannels();
            } else if (page === 'pipette') {
                // nothing to load, but ensure canvas resizes
                resizePipetteCanvas();
                // layout pass first
                setTimeout(resizePipetteCanvas, 0);
            } else if (page === 'maps') {
                loadMaps();
            }
        });
    });
}

// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Show loader
    showLoader();

    // Setup navigation
    setupNavigation();
    
    // Setup chart tabs
    setupChartTabs();
    
    // Setup demo modal
    setupDemoModal();

    // Setup pipette
    setupPipette();

    // Setup maps page
    setupMapsPage();

    // Sidebar expand persistence
    setupSidebarHover();

    // Period selector
    document.getElementById('period-select').addEventListener('change', (e) => {
        loadAnalytics(parseInt(e.target.value));
    });

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        const days = parseInt(document.getElementById('period-select').value);
        loadAnalytics(days);
    });

    // Guild selector
    document.getElementById('guild-select').addEventListener('change', (e) => {
        if (e.target.value) {
            loadChannels(e.target.value);
        } else {
            document.getElementById('channel-select').disabled = true;
            document.getElementById('channel-select').innerHTML = '<option value="">Сначала выберите сервер...</option>';
        }
    });

    // Channel selector
    document.getElementById('channel-select').addEventListener('change', (e) => {
        const hasChannel = !!e.target.value;
        document.getElementById('send-message-btn').disabled = !hasChannel;
        document.getElementById('read-messages-btn').disabled = !hasChannel;
        
        // Hide messages container when changing channels
        if (!hasChannel) {
            document.getElementById('messages-container').style.display = 'none';
        }
    });

    // Send message button
    document.getElementById('send-message-btn').addEventListener('click', () => {
        const channelId = document.getElementById('channel-select').value;
        const content = document.getElementById('message-content').value.trim();

        if (!channelId || !content) {
            alert('Выберите канал и введите сообщение!');
            return;
        }

        sendMessage(channelId, content);
    });

    // Read messages button
    document.getElementById('read-messages-btn').addEventListener('click', () => {
        const channelId = document.getElementById('channel-select').value;

        if (!channelId) {
            alert('Выберите канал!');
            return;
        }

        readMessages(channelId);
    });

    // Load initial data
    await loadAnalytics(30);

    // Hide loader after 1 second
    setTimeout(hideLoader, 1000);

    // Auto-refresh every minute
    autoRefreshInterval = setInterval(() => {
        const activePage = document.querySelector('.page.active');
        if (activePage.id === 'page-analytics') {
            const days = parseInt(document.getElementById('period-select').value);
            loadAnalytics(days);
        } else if (activePage.id === 'page-channels') {
            loadAutoDeleteChannels();
        }
    }, 60000); // 60 seconds
});

function setupSidebarHover() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    let collapseTimer = null;
    const expand = () => {
        sidebar.classList.add('expanded');
        if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
    };
    const scheduleCollapse = () => {
        if (collapseTimer) clearTimeout(collapseTimer);
        collapseTimer = setTimeout(() => sidebar.classList.remove('expanded'), 220);
    };
    sidebar.addEventListener('mouseenter', expand);
    sidebar.addEventListener('mouseleave', scheduleCollapse);
    // start collapsed
    sidebar.classList.remove('expanded');
}
// ============================================
// PIPETTE (EYEDROPPER) TOOL
// ============================================

let pipetteImage = null;

function setupPipette() {
    const fileInput = document.getElementById('pipette-file');
    const dropZone = document.getElementById('pipette-drop');
    const canvasWrap = document.getElementById('pipette-canvas-wrap');
    const canvas = document.getElementById('pipette-canvas');
    const magnifier = document.getElementById('pipette-magnifier');
    if (!fileInput || !dropZone || !canvas) return;

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) loadPipetteImage(file);
    });

    ;['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary');
    }));

    ;['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color');
    }));

    dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadPipetteImage(file);
    });

    // Paste image from clipboard (Ctrl+V)
    window.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.type && it.type.indexOf('image') !== -1) {
                const blob = it.getAsFile();
                if (blob) loadPipetteImage(blob);
                e.preventDefault();
                break;
            }
        }
    });

    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.copy;
            const input = document.getElementById(id);
            if (input) {
                navigator.clipboard.writeText(input.value).then(() => showToast('Скопировано'));
            }
        });
    });

    let pipetteFrozen = false;
    canvas.addEventListener('mousemove', (e) => {
        if (pipetteFrozen) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let x = Math.floor((e.clientX - rect.left) * scaleX);
        let y = Math.floor((e.clientY - rect.top) * scaleY);
        x = Math.max(0, Math.min(canvas.width - 1, x));
        y = Math.max(0, Math.min(canvas.height - 1, y));
        const ctx = canvas.getContext('2d');
        try {
            const data = ctx.getImageData(x, y, 1, 1).data;
            updatePipetteOutputs(data[0], data[1], data[2]);
            drawMagnifier(canvas, magnifier, x, y);
        } catch {}
    });

    canvas.addEventListener('click', () => {
        pipetteFrozen = !pipetteFrozen;
        showToast(pipetteFrozen ? 'Захвачено' : 'Разморозка');
    });

    window.addEventListener('resize', resizePipetteCanvas);

    // Hotkeys: Space toggle freeze, C copy HEX
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            pipetteFrozen = !pipetteFrozen;
            showToast(pipetteFrozen ? 'Захвачено' : 'Разморозка', 'success');
        } else if (e.key && (e.key === 'c' || e.key === 'C')) {
            const hex = document.getElementById('pipette-hex');
            if (hex) {
                navigator.clipboard.writeText(hex.value).then(() => showToast('HEX скопирован', 'success'));
            }
        }
    });

    function loadPipetteImage(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            pipetteImage = img;
            drawPipetteImage();
            canvasWrap.style.display = 'block';
            if (dropZone) dropZone.style.display = 'none';
            showToast('Изображение загружено', 'success');
            URL.revokeObjectURL(url);
        };
        img.onerror = () => showToast('Не удалось загрузить изображение');
        img.src = url;
    }
}

function drawPipetteImage() {
    const canvas = document.getElementById('pipette-canvas');
    if (!canvas || !pipetteImage) return;
    const ctx = canvas.getContext('2d');
    const wrap = document.getElementById('pipette-canvas-wrap');
    const availableW = wrap.clientWidth || pipetteImage.width;
    const maxH = Math.floor(window.innerHeight * 0.7);
    const byW = availableW / pipetteImage.width;
    const byH = maxH / pipetteImage.height;
    const ratio = Math.min(1, byW, byH);
    const cssW = Math.max(1, Math.floor(pipetteImage.width * ratio));
    const cssH = Math.max(1, Math.floor(pipetteImage.height * ratio));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(pipetteImage, 0, 0, cssW, cssH);
}

function drawMagnifier(srcCanvas, magCanvas, cx, cy) {
    if (!magCanvas) return;
    const magSize = 120; // css size (match CSS)
    magCanvas.width = magSize;
    magCanvas.height = magSize;
    const ctx = magCanvas.getContext('2d');
    const scale = 10; // 10x zoom
    const sw = Math.floor(magCanvas.width / scale);
    const sh = Math.floor(magCanvas.height / scale);
    const sx = Math.max(0, Math.min(srcCanvas.width - sw, cx - Math.floor(sw / 2)));
    const sy = Math.max(0, Math.min(srcCanvas.height - sh, cy - Math.floor(sh / 2)));
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, magCanvas.width, magCanvas.height);
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, magCanvas.width, magCanvas.height);
    // crosshair for exact pixel in center
    const center = Math.floor(magCanvas.width / 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center, 0); ctx.lineTo(center, magCanvas.height); // vertical
    ctx.moveTo(0, center); ctx.lineTo(magCanvas.width, center); // horizontal
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center + 1, 0); ctx.lineTo(center + 1, magCanvas.height);
    ctx.moveTo(0, center + 1); ctx.lineTo(magCanvas.width, center + 1);
    ctx.stroke();
    // position near cursor
    const rect = srcCanvas.getBoundingClientRect();
    const scaleX = rect.width / srcCanvas.width;
    const scaleY = rect.height / srcCanvas.height;
    const cssX = cx * scaleX;
    const cssY = cy * scaleY;
    let left = Math.round(cssX + 16);
    let top = Math.round(cssY + 16);
    if (left + magSize > rect.width) left = Math.round(cssX - magSize - 16);
    if (top + magSize > rect.height) top = Math.round(cssY - magSize - 16);
    if (left < 0) left = 0; if (top < 0) top = 0;
    magCanvas.style.left = `${left}px`;
    magCanvas.style.top = `${top}px`;
}

function resizePipetteCanvas() {
    if (pipetteImage) drawPipetteImage();
}

function updatePipetteOutputs(r, g, b) {
    const hex = rgbToHex(r, g, b);
    const cmyk = rgbToCmyk(r, g, b);
    const hsv = rgbToHsv(r, g, b);
    const hsl = rgbToHsl(r, g, b);

    setInput('pipette-hex', hex);
    setInput('pipette-rgb', `${r}, ${g}, ${b}`);
    setInput('pipette-cmyk', `${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%`);
    setInput('pipette-hsv', `${hsv.h}°, ${hsv.s}%, ${hsv.v}%`);
    setInput('pipette-hsl', `${hsl.h}°, ${hsl.s}%, ${hsl.l}%`);
    const colorBox = document.getElementById('pipette-result-color');
    if (colorBox) colorBox.style.background = hex;
}

function setInput(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function rgbToHex(r, g, b) {
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToCmyk(r, g, b) {
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const k = 1 - Math.max(rr, gg, bb);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
    const c = Math.round(((1 - rr - k) / (1 - k)) * 100);
    const m = Math.round(((1 - gg - k) / (1 - k)) * 100);
    const y = Math.round(((1 - bb - k) / (1 - k)) * 100);
    const kk = Math.round(k * 100);
    return { c, m, y, k: kk };
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) h = 0; else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function showToast(message, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('success');
    if (type === 'success') el.classList.add('success');
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

// ============================================
// MAPS HOSTING PAGE
// ============================================

function setupMapsPage() {
    const fileInput = document.getElementById('maps-file');
    const dropZone = document.getElementById('maps-drop');
    
    if (!fileInput || !dropZone) return;

    // File input change
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
            if (!file.name.toLowerCase().endsWith('.map')) {
                showToast('Пожалуйста, выберите файл с расширением .map');
                return;
            }
            uploadMap(file);
        }
    });

    // Click on drop zone
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    // Drag and drop
    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
            if (!file.name.toLowerCase().endsWith('.map')) {
                showToast('Пожалуйста, перетащите файл с расширением .map');
                return;
            }
            uploadMap(file);
        }
    });
}

async function uploadMap(file) {
    const formData = new FormData();
    formData.append('map', file);

    const progressDiv = document.getElementById('maps-upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const dropZone = document.getElementById('maps-drop');

    progressDiv.style.display = 'block';
    dropZone.style.opacity = '0.5';
    dropZone.style.pointerEvents = 'none';

    try {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressFill.style.width = percent + '%';
                progressText.textContent = `Загрузка: ${percent}%`;
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                showToast('Карта успешно загружена!', 'success');
                progressDiv.style.display = 'none';
                dropZone.style.opacity = '1';
                dropZone.style.pointerEvents = 'auto';
                loadMaps();
            } else {
                const error = JSON.parse(xhr.responseText);
                throw new Error(error.error || 'Ошибка загрузки');
            }
        });

        xhr.addEventListener('error', () => {
            throw new Error('Ошибка соединения');
        });

        xhr.open('POST', `${API_URL}/api/maps/upload`);
        xhr.send(formData);
    } catch (error) {
        showToast(`Ошибка: ${error.message}`);
        progressDiv.style.display = 'none';
        dropZone.style.opacity = '1';
        dropZone.style.pointerEvents = 'auto';
    }
}

async function loadMaps() {
    try {
        const response = await fetch(`${API_URL}/api/maps`);
        const maps = await response.json();

        const container = document.getElementById('maps-list');
        if (!container) return;

        if (maps.length === 0) {
            container.innerHTML = '<p class="maps-empty">Загрузите первую карту для начала</p>';
            return;
        }

        const baseUrl = window.location.origin;
        container.innerHTML = maps.map(map => {
            const downloadUrl = `${baseUrl}/api/maps/download/${map.id}`;
            const uploadDate = new Date(map.uploaded_at).toLocaleString('ru-RU');
            const fileSize = formatFileSize(map.file_size || 0);

            return `
                <div class="map-card">
                    <div class="map-info">
                        <h4 class="map-name">${escapeHtml(map.original_name)}</h4>
                        <div class="map-meta">
                            <span>📅 ${uploadDate}</span>
                            <span>📦 ${fileSize}</span>
                        </div>
                    </div>
                    <div class="map-link-section">
                        <input type="text" class="map-link-input" value="${downloadUrl}" readonly id="map-link-${map.id}">
                        <button class="map-link-btn" onclick="copyMapLink('${map.id}')">⧉ Копировать</button>
                        <button class="map-delete-btn" onclick="deleteMap('${map.id}')">🗑️ Удалить</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading maps:', error);
        showToast('Ошибка загрузки списка карт');
    }
}

window.copyMapLink = function(mapId) {
    const input = document.getElementById(`map-link-${mapId}`);
    if (!input) return;

    input.select();
    input.setSelectionRange(0, 99999);

    navigator.clipboard.writeText(input.value).then(() => {
        const btn = input.nextElementSibling;
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = '✓ Скопировано';
            btn.classList.add('copy-success');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copy-success');
            }, 2000);
        }
        showToast('Ссылка скопирована!', 'success');
    }).catch(() => {
        showToast('Не удалось скопировать ссылку');
    });
};

window.deleteMap = async function(mapId) {
    if (!confirm('Вы уверены, что хотите удалить эту карту?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/maps/${mapId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('Карта удалена', 'success');
            loadMaps();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка удаления');
        }
    } catch (error) {
        showToast(`Ошибка: ${error.message}`);
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

