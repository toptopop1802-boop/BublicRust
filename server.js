const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Supabase Client (guard missing env)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.warn('⚠️  SUPABASE_URL or SUPABASE_KEY is not set. Supabase-dependent endpoints will return 503.');
}

// Discord Client (для отправки сообщений)
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let discordReady = false;

discordClient.once('ready', () => {
    console.log(`✅ Discord bot connected as ${discordClient.user.tag}`);
    discordReady = true;
});

discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error('❌ Failed to login to Discord:', err);
});

// ============================================
// API ENDPOINTS
// ============================================

// Получить статистику за период
app.get('/api/stats', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }
        const days = parseInt(req.query.days) || 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const { data, error } = await supabase
            .from('server_analytics')
            .select('*')
            .gte('created_at', cutoffDate.toISOString())
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Группируем по типам событий
        const stats = {
            wipe_created: 0,
            ticket_created: 0,
            tournament_role_created: 0,
            channel_deleted: 0,
            member_count: 0,
            timeline: []
        };

        const timelineMap = new Map();

        data.forEach(event => {
            // Подсчет по типам
            stats[event.event_type] = (stats[event.event_type] || 0) + 1;

            // Временная шкала (по дням)
            const date = new Date(event.created_at).toISOString().split('T')[0];
            if (!timelineMap.has(date)) {
                timelineMap.set(date, {
                    date,
                    wipe_created: 0,
                    ticket_created: 0,
                    tournament_role_created: 0,
                    channel_deleted: 0,
                    member_count: 0
                });
            }
            const dayStats = timelineMap.get(date);
            if (event.event_type === 'member_count') {
                const count = (event.event_data && (event.event_data.count || event.event_data["count"])) || 0;
                // сохраняем последний или максимальный на день
                dayStats.member_count = Math.max(dayStats.member_count || 0, count);
                stats.member_count = Math.max(stats.member_count || 0, count);
            } else {
                dayStats[event.event_type] = (dayStats[event.event_type] || 0) + 1;
                stats[event.event_type] = (stats[event.event_type] || 0) + 1;
            }
        });

        stats.timeline = Array.from(timelineMap.values());
        stats.total = data.length;

        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить активные каналы для автоудаления
app.get('/api/auto-delete-channels', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ error: 'Supabase not configured' });
        }
        const { data, error } = await supabase
            .from('auto_delete_channels')
            .select('*')
            .eq('status', 'active')
            .order('delete_at', { ascending: true });

        if (error) throw error;

        // Добавляем оставшееся время
        const now = new Date();
        const channels = data.map(ch => ({
            ...ch,
            time_left_seconds: Math.max(0, Math.floor((new Date(ch.delete_at) - now) / 1000))
        }));

        res.json(channels);
    } catch (error) {
        console.error('Error fetching auto-delete channels:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить список серверов
app.get('/api/guilds', async (req, res) => {
    try {
        if (!discordReady) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }

        const guilds = discordClient.guilds.cache.map(guild => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL(),
            memberCount: guild.memberCount
        }));

        res.json(guilds);
    } catch (error) {
        console.error('Error fetching guilds:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить каналы сервера
app.get('/api/guilds/:guildId/channels', async (req, res) => {
    try {
        if (!discordReady) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }

        const guild = discordClient.guilds.cache.get(req.params.guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Guild not found' });
        }

        const channels = guild.channels.cache
            .filter(ch => ch.isTextBased())
            .map(ch => ({
                id: ch.id,
                name: ch.name,
                type: ch.type
            }));

        res.json(channels);
    } catch (error) {
        console.error('Error fetching channels:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить сообщения из канала
app.get('/api/channels/:channelId/messages', async (req, res) => {
    try {
        if (!discordReady) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }

        const channel = await discordClient.channels.fetch(req.params.channelId);
        if (!channel || !channel.isTextBased()) {
            return res.status(404).json({ error: 'Channel not found or not text-based' });
        }

        const messages = await channel.messages.fetch({ limit: 50 });
        
        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            content: msg.content,
            author: msg.author.tag,
            authorId: msg.author.id,
            timestamp: msg.createdAt.toISOString(),
            attachments: msg.attachments.map(att => ({
                url: att.url,
                name: att.name
            }))
        })).reverse(); // Reverse to show oldest first

        res.json(formattedMessages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// Отправить сообщение от имени бота
app.post('/api/send-message', async (req, res) => {
    try {
        if (!discordReady) {
            return res.status(503).json({ error: 'Discord bot not ready' });
        }

        const { channelId, content, embed } = req.body;

        if (!channelId || (!content && !embed)) {
            return res.status(400).json({ error: 'channelId and content/embed are required' });
        }

        const channel = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
            return res.status(404).json({ error: 'Channel not found or not text-based' });
        }

        const messageOptions = {};
        if (content) messageOptions.content = content;
        if (embed) messageOptions.embeds = [embed];

        const message = await channel.send(messageOptions);

        res.json({
            success: true,
            messageId: message.id,
            channelId: message.channelId
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        discord: discordReady,
        supabase: !!supabase,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Dashboard server running on http://localhost:${PORT}`);
    console.log(`📊 Visit http://localhost:${PORT} to view analytics`);
});

