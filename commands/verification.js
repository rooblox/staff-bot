'use strict';
// commands/verification.js
// Verification setup wizard + verify flows for all 4 methods.
// ─────────────────────────────────────────────────────────────
// Methods:
//   1. button   — embed with "Verify" button, role assigned instantly on click
//   2. slash    — /verify command, role assigned instantly
//   3. dm       — bot DMs custom questions; answers submitted; staff approves
//   4. format   — user posts in verify channel (strict or any); staff approves
//
// Setup: /setup verification  (bot-perms-role only)
// One-time ping per server on first boot (stored in VerifySetupPing collection)
// ─────────────────────────────────────────────────────────────

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');

let _canvas;
function getCanvas() {
    if (!_canvas) _canvas = require('@napi-rs/canvas');
    return _canvas;
}
const path = require('path');

// ── Pending setup sessions (in-memory, keyed by userId) ──────────────────────
const pendingSetups = new Map();
// ── Pending DM verify sessions (userId → { config, guildId, answers, qIndex, rankRoleIds }) ──
const pendingDMVerify = new Map();
// ── Pending rank picks (userId → { config, guildId, next }) ──────────────────
// next = 'dm_start' | 'instant' | 'format_wait'
const pendingRankPick = new Map();

// ─────────────────────────────────────────────────────────────
// SLASH COMMAND DEFINITIONS
// ─────────────────────────────────────────────────────────────

const setupVerificationCommand = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Server setup commands')
    .addSubcommand(sub =>
        sub.setName('verification')
           .setDescription('Set up the verification system for this server')
    );

const verifyCommand = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify yourself in this server');

// ─────────────────────────────────────────────────────────────
// IMAGE GENERATION
// ─────────────────────────────────────────────────────────────

// Background image path — place bg.png in assets/verification/bg.png
const BG_PATH = path.join(__dirname, '..', 'assets', 'verification', 'bg.png');

async function generateVerifyCard(serverName) {
    const { createCanvas, loadImage } = getCanvas();
    const W = 900, H = 300;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background
    try {
        const bg = await loadImage(BG_PATH);
        ctx.drawImage(bg, 0, 0, W, H);
    } catch {
        // fallback gradient if bg missing
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#1a0a2e');
        grad.addColorStop(1, '#2d1b6b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // Purple overlay
    ctx.fillStyle = 'rgba(60, 0, 120, 0.55)';
    ctx.fillRect(0, 0, W, H);

    // "KAVIÀ CAFÉ" — large bold white with purple shadow
    ctx.textAlign = 'center';
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 18;

    ctx.font = 'bold 72px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('KAVIÀ CAFÉ', W / 2, H / 2 - 10);

    // Subtitle — server name
    ctx.shadowBlur = 8;
    ctx.font = 'bold 28px Arial';
    ctx.fillStyle = '#e0d7ff';
    ctx.letterSpacing = '4px';
    ctx.fillText(serverName.toUpperCase(), W / 2, H / 2 + 48);

    ctx.shadowBlur = 0;

    return canvas.encode('png');
}

// ─────────────────────────────────────────────────────────────
// DB HELPERS (lazy-required to avoid circular deps)
// ─────────────────────────────────────────────────────────────

function db() { return require('../db'); }

// ─────────────────────────────────────────────────────────────
// SETUP WIZARD HELPERS
// ─────────────────────────────────────────────────────────────

function stepEmbed(title, desc) {
    return new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle(`🔧 Verification Setup — ${title}`)
        .setDescription(desc)
        .setFooter({ text: 'Kavià Café • Verification Setup' });
}

async function sendStep(interaction, session, isDeferred = false) {
    const { step } = session;
    let embed, components = [];

    if (step === 'pick_method') {
        embed = stepEmbed('Step 1: Verify Method', 'How should members verify in this server?');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_method_button_${interaction.user.id}`).setLabel('🔘 Button').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_method_slash_${interaction.user.id}`).setLabel('⌨️ /verify Command').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_method_dm_${interaction.user.id}`).setLabel('💬 DM Questions').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`vsetup_method_format_${interaction.user.id}`).setLabel('📋 Channel Format').setStyle(ButtonStyle.Secondary)
        )];

    } else if (step === 'pick_roles') {
        embed = stepEmbed('Step 2: Roles to Assign', 'Which role(s) should be given to verified members?\n\nType the role IDs separated by commas in the box below, or use the button to enter them.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterroles_${interaction.user.id}`).setLabel('Enter Role IDs').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_channel') {
        embed = stepEmbed('Step 3: Verify Channel', 'Which channel should the verification embed be posted in?');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterchannel_${interaction.user.id}`).setLabel('Enter Channel ID').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_format_strictness') {
        embed = stepEmbed('Step 3b: Format Strictness', 'Should the bot be strict about the format, or accept any message in the channel?\n\n**Strict** — only messages matching the required fields are accepted.\n**Any message** — any message in the channel counts as a verification attempt.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_strict_yes_${interaction.user.id}`).setLabel('📐 Strict Format').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_strict_no_${interaction.user.id}`).setLabel('💬 Any Message').setStyle(ButtonStyle.Secondary)
        )];

    } else if (step === 'pick_format_fields') {
        embed = stepEmbed('Step 3c: Format Fields', 'Enter the required field names for the format, separated by commas.\n\nExample: `Roblox Username, Discord Username, Rank, Proof of Invite`\n\nMembers will be shown this template when verifying.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterfields_${interaction.user.id}`).setLabel('Enter Fields').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_dm_questions') {
        embed = stepEmbed('Step 3b: DM Questions', 'Enter the questions you want to ask members in DMs, one per line.\n\nUse the button below to open the input box.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterdmq_${interaction.user.id}`).setLabel('Enter Questions').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_approval_role') {
        embed = stepEmbed('Step 4: Approver Role', 'Which role can approve or deny verification requests?\n\nEnter the role ID.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterapprole_${interaction.user.id}`).setLabel('Enter Approver Role ID').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_review_channel') {
        embed = stepEmbed('Step 5: Review Channel', 'Which channel should pending verification requests be posted in for staff to review?');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterreviewch_${interaction.user.id}`).setLabel('Enter Channel ID').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_log_channel') {
        embed = stepEmbed('Step 6: Log Channel', 'Which channel should verification approvals/denials be logged in?');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterlogch_${interaction.user.id}`).setLabel('Enter Channel ID').setStyle(ButtonStyle.Primary)
        )];

    } else if (step === 'pick_rank_categories') {
        const existing = (session.rankCategories || []).map(c => `• **${c.name}** → <@&${c.roleId}>`).join('\n') || '*None added yet*';
        embed = stepEmbed('Optional: Rank Categories', `Do you want rank-based role assignment?\n\nWhen enabled, members pick their rank before verifying and get the matching role assigned.\n\n**Categories added so far:**\n${existing}`);
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_addrank_${interaction.user.id}`).setLabel('➕ Add a Rank').setStyle(ButtonStyle.Primary),
            ...(session.rankCategories?.length ? [new ButtonBuilder().setCustomId(`vsetup_rankdone_${interaction.user.id}`).setLabel('✅ Done Adding Ranks').setStyle(ButtonStyle.Success)] : []),
            new ButtonBuilder().setCustomId(`vsetup_skipranks_${interaction.user.id}`).setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary)
        )];

    } else if (step === 'pick_notify_role') {
        embed = stepEmbed('Optional: Notify Role', 'Should a role be pinged in the review channel (or log channel) whenever someone submits a verification?\n\nPaste the role ID or mention, or skip to disable.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enternotifyrole_${interaction.user.id}`).setLabel('Enter Notify Role').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_skipnotify_${interaction.user.id}`).setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary)
        )];

    } else if (step === 'pick_embed_desc') {
        embed = stepEmbed('Final Step: Embed Description', 'Enter a custom description for the verification embed that members will see, or skip to use the default.');
        components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_enterdesc_${interaction.user.id}`).setLabel('Enter Description').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_skipdesc_${interaction.user.id}`).setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary)
        )];
    }

    const payload = { embeds: [embed], components };
    if (isDeferred) return interaction.editReply(payload);
    if (interaction.isModalSubmit?.() || interaction.isChatInputCommand?.()) return interaction.reply({ ...payload, flags: 64 });
    if (interaction.isButton?.()) return interaction.update(payload);
    return interaction.reply({ ...payload, flags: 64 });
}

// ─────────────────────────────────────────────────────────────
// FINISH SETUP — save config and post embed
// ─────────────────────────────────────────────────────────────

async function finishSetup(interaction, session, client) {
    const { VerifyConfig } = db();
    const guildId = interaction.guild?.id || session.guildId;

    // Save to DB
    await VerifyConfig.findOneAndUpdate(
        { guildId },
        {
            guildId,
            guildName: session.guildName,
            method: session.method,
            roleIds: session.roleIds,
            channelId: session.channelId,
            embedDescription: session.embedDescription || null,
            // approval flow (dm / format)
            approvalRoleId: session.approvalRoleId || null,
            reviewChannelId: session.reviewChannelId || null,
            logChannelId: session.logChannelId || null,
            // dm questions
            dmQuestions: session.dmQuestions || [],
            // format
            formatStrict: session.formatStrict ?? false,
            formatFields: session.formatFields || [],
            // rank categories
            rankCategories: session.rankCategories || [],
            // notify role
            notifyRoleId: session.notifyRoleId || null,
            updatedAt: new Date()
        },
        { upsert: true, returnDocument: 'after' }
    );

    pendingSetups.delete(interaction.user.id);

    // Post the verification embed in the chosen channel
    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel) {
        const payload = { content: '✅ Config saved! But I couldn\'t find the verify channel — double-check the ID and re-run setup.', embeds: [], components: [] };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        return interaction.update(payload);
    }

    const imgBuf = await generateVerifyCard(session.guildName).catch(() => null);
    const attachment = imgBuf ? { attachment: imgBuf, name: 'verify.png' } : null;

    const verifyEmbed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('✅ Verification')
        .setDescription(session.embedDescription || 'Click the button below to verify yourself in this server.')
        .setImage(attachment ? 'attachment://verify.png' : null)
        .setFooter({ text: 'Kavià Café' });

    const hasRanks = session.rankCategories?.length > 0;
    const needsButton = session.method === 'button';

    // Build instructions note
    const methodNote = {
        button: hasRanks ? '> Select your rank below, then click **Verify**.' : '> Click the button below to verify yourself.',
        slash:  hasRanks ? '> Select your rank below, then run **/verify**.' : '> Run **/verify** to verify yourself.',
        dm:     hasRanks ? '> Select your rank below, then click **Start Verification**.' : '> Click the button below — the bot will DM you a few questions.',
        format: hasRanks
            ? (session.formatStrict
                ? `> Select your rank below, then post your verification using the required format:\n${(session.formatFields || []).map(f => `> **${f}:**`).join('\n')}`
                : '> Select your rank below, then send a message in this channel.')
            : (session.formatStrict
                ? `> Post your verification in this channel using the required format:\n${(session.formatFields || []).map(f => `> **${f}:**`).join('\n')}`
                : '> Send a message in this channel to submit your verification.')
    }[session.method] || '';
    verifyEmbed.setDescription((session.embedDescription || 'Welcome!') + (methodNote ? `\n\n${methodNote}` : ''));

    const components = [];

    // Rank dropdown (shown first if ranks exist)
    if (hasRanks) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`verify_pick_rank_${guildId}`)
                .setPlaceholder('Select your rank...')
                .addOptions(session.rankCategories.map(c => ({ label: c.name, value: c.roleId })))
        ));
    }

    // Action button
    if (needsButton || session.method === 'dm') {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(session.method === 'dm' ? `verify_dm_start_${guildId}` : `verify_click_${guildId}`)
                .setLabel(session.method === 'dm' ? '💬 Start Verification' : '✅ Verify')
                .setStyle(session.method === 'dm' ? ButtonStyle.Primary : ButtonStyle.Success)
        ));
    }

    const msgPayload = {
        embeds: [verifyEmbed],
        ...(attachment ? { files: [attachment] } : {}),
        ...(components.length ? { components } : {})
    };

    await channel.send(msgPayload);

    const successPayload = { content: `✅ Verification system set up! Embed posted in <#${session.channelId}>.`, embeds: [], components: [] };
    if (interaction.deferred || interaction.replied) return interaction.editReply(successPayload);
    return interaction.update(successPayload);
}

// ─────────────────────────────────────────────────────────────
// VERIFY HELPERS — assign roles + send card
// ─────────────────────────────────────────────────────────────

async function doVerify(interaction, config, client, rankRoleId = null) {
    const member = interaction.member;
    const guildId = interaction.guild.id;

    // Check already verified (has ALL configured roles)
    const hasAll = config.roleIds.every(rid => member.roles.cache.has(rid));
    if (hasAll) {
        const reply = interaction.deferred ? interaction.editReply.bind(interaction) : (p) => interaction.reply({ ...p, flags: 64 });
        return reply({ content: '✅ You\'re already verified in this server!' });
    }

    // Assign base verify roles
    for (const rid of config.roleIds) {
        await member.roles.add(rid).catch(() => {});
    }

    // Assign rank role (if selected)
    if (rankRoleId) {
        await member.roles.add(rankRoleId).catch(() => {});
    }

    // Notify role ping in log channel (if configured)
    if (config.notifyRoleId && config.logChannelId) {
        const logCh = await client.channels.fetch(config.logChannelId).catch(() => null);
        if (logCh) {
            const rankInfo = rankRoleId
                ? config.rankCategories?.find(c => c.roleId === rankRoleId)
                : null;
            await logCh.send({
                content: `<@&${config.notifyRoleId}>`,
                embeds: [new EmbedBuilder()
                    .setColor(0x22c55e)
                    .setTitle('✅ Member Verified')
                    .setDescription(`<@${interaction.user.id}> (${interaction.user.tag}) verified in **${config.guildName}**${rankInfo ? `\n**Rank:** ${rankInfo.name}` : ''}`)
                    .setTimestamp()]
            }).catch(() => {});
        }
    }

    // Send card to user
    const imgBuf = await generateVerifyCard(config.guildName).catch(() => null);
    const payload = {
        content: `✅ You've been verified in **${config.guildName}**!`,
        ...(imgBuf ? { files: [{ attachment: imgBuf, name: 'verified.png' }] } : {})
    };
    if (interaction.deferred) return interaction.editReply(payload);
    return interaction.reply({ ...payload, flags: 64 });
}

// Send a pending verification request to the review channel for staff approval
async function sendApprovalRequest(client, config, userId, userTag, guildId, answers, interaction, rankName = null, rankRoleId = null) {
    const { VerifyRequest } = db();

    const req = await VerifyRequest.create({
        guildId,
        userId,
        userTag,
        answers,
        rankName: rankName || null,
        rankRoleId: rankRoleId || null,
        status: 'pending',
        reviewChannelId: config.reviewChannelId,
        logChannelId: config.logChannelId,
        createdAt: new Date()
    });

    const reviewCh = await client.channels.fetch(config.reviewChannelId).catch(() => null);
    if (!reviewCh) return;

    let desc = `**User:** <@${userId}> (${userTag})\n**Server:** ${config.guildName}`;
    if (rankName) desc += `\n**Selected Rank:** ${rankName}`;

    const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('📋 Verification Request')
        .setDescription(desc)
        .setFooter({ text: `Request ID: ${req._id}` })
        .setTimestamp();

    if (answers && answers.length) {
        const fields = config.method === 'dm'
            ? answers.map((a, i) => ({ name: config.dmQuestions[i] || `Q${i + 1}`, value: a || '*no answer*', inline: false }))
            : [{ name: 'Submission', value: answers[0] || '*empty*', inline: false }];
        embed.addFields(fields.slice(0, 25));
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verify_approve_${req._id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`verify_deny_${req._id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger)
    );

    // Ping: approver role + optional notify role
    const pings = [
        config.approvalRoleId ? `<@&${config.approvalRoleId}>` : '',
        config.notifyRoleId && config.notifyRoleId !== config.approvalRoleId ? `<@&${config.notifyRoleId}>` : ''
    ].filter(Boolean).join(' ');
    await reviewCh.send({ content: pings || undefined, embeds: [embed], components: [row] });

    // Acknowledge to user
    if (interaction) {
        await interaction.reply({ content: '📋 Your verification has been submitted! Staff will review it shortly.', flags: 64 }).catch(() => {});
    }
}

// ─────────────────────────────────────────────────────────────
// ONE-TIME PING PER SERVER
// ─────────────────────────────────────────────────────────────

async function sendOneTimePings(client, botPermsRoleMap) {
    const { VerifyConfig, VerifySetupPing } = db();

    for (const guild of client.guilds.cache.values()) {
        try {
            // Skip if already pinged
            const pinged = await VerifySetupPing.findOne({ guildId: guild.id });
            if (pinged) continue;

            // Skip if already configured
            const existing = await VerifyConfig.findOne({ guildId: guild.id });
            if (existing) {
                // Mark as pinged anyway so we never ping a configured server
                await VerifySetupPing.create({ guildId: guild.id, sentAt: new Date() });
                continue;
            }

            // Find the bot perms role in this guild
            const botPermsRoleId = botPermsRoleMap[guild.id];
            if (!botPermsRoleId) continue;

            // Post in the first text channel the bot can send in
            const channel = guild.channels.cache
                .filter(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('SendMessages'))
                .sort((a, b) => a.position - b.position)
                .first();
            if (!channel) continue;

            const embed = new EmbedBuilder()
                .setColor(0x7c3aed)
                .setTitle('🔐 Verification System Available')
                .setDescription(`Hey <@&${botPermsRoleId}>! 👋\n\nWould you like to set up a **verification system** for this server?\n\nStaff with the bot permissions role can run **/setup verification** to configure it — choose from buttons, slash commands, DM questions, or channel format verification.\n\n*This message will only appear once.*`)
                .setFooter({ text: 'Kavià Café Staff Bot' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`verify_setup_start_${guild.id}`).setLabel('🔧 Set Up Verification').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`verify_setup_dismiss_${guild.id}`).setLabel('Not Now').setStyle(ButtonStyle.Secondary)
            );

            await channel.send({ embeds: [embed], components: [row] });
            await VerifySetupPing.create({ guildId: guild.id, sentAt: new Date() });
        } catch (e) {
            console.warn(`[verify] One-time ping failed for ${guild.name}:`, e.message);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// INTERACTION HANDLER  (export this — called from index.js)
// ─────────────────────────────────────────────────────────────

async function handleVerificationInteraction(interaction, client) {
    const { VerifyConfig, VerifyRequest } = db();
    const userId = interaction.user.id;
    const id = interaction.customId || '';

    // ── /setup verification ───────────────────────────────────────────────────
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'setup' && interaction.options.getSubcommand() === 'verification') {
        // Permission check: bot perms role only (checked via REQUIRED_BUTTON_ROLE_ID passed in or member perms)
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
            !interaction.member.roles.cache.has(process.env.BOT_PERMS_ROLE_ID)) {
            return interaction.reply({ content: '❌ You need the bot permissions role to run this command.', flags: 64 });
        }
        const session = {
            guildId: interaction.guild.id,
            guildName: interaction.guild.name,
            step: 'pick_method'
        };
        pendingSetups.set(userId, session);
        return sendStep(interaction, session);
    }

    // ── /verify ───────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'verify') {
        const config = await VerifyConfig.findOne({ guildId: interaction.guild.id });
        if (!config) return interaction.reply({ content: '❌ Verification isn\'t set up for this server yet.', flags: 64 });
        if (config.method !== 'slash') return interaction.reply({ content: '❌ This server uses a different verification method.', flags: 64 });

        // Pick up rank selection if present
        const rankPick = pendingRankPick.get(userId);
        const rankRoleId = (rankPick?.guildId === interaction.guild.id) ? rankPick.rankRoleId : null;
        if (config.rankCategories?.length && !rankRoleId) {
            return interaction.reply({ content: '⚠️ Please select your rank from the dropdown in the verify channel before running `/verify`.', flags: 64 });
        }
        if (rankRoleId) pendingRankPick.delete(userId);
        return doVerify(interaction, config, client, rankRoleId);
    }

    // ── One-time ping buttons ─────────────────────────────────────────────────
    if (id.startsWith('verify_setup_start_')) {
        const guildId = id.replace('verify_setup_start_', '');
        if (interaction.guild?.id !== guildId) return;
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
            !interaction.member.roles.cache.has(process.env.BOT_PERMS_ROLE_ID)) {
            return interaction.reply({ content: '❌ You need the bot permissions role to do this.', flags: 64 });
        }
        const session = { guildId, guildName: interaction.guild.name, step: 'pick_method' };
        pendingSetups.set(userId, session);
        return interaction.reply({ embeds: [stepEmbed('Step 1: Verify Method', 'How should members verify in this server?')], components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vsetup_method_button_${userId}`).setLabel('🔘 Button').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_method_slash_${userId}`).setLabel('⌨️ /verify Command').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vsetup_method_dm_${userId}`).setLabel('💬 DM Questions').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`vsetup_method_format_${userId}`).setLabel('📋 Channel Format').setStyle(ButtonStyle.Secondary)
        )], flags: 64 });
    }

    if (id.startsWith('verify_setup_dismiss_')) {
        return interaction.update({ content: 'Got it! You can run **/setup verification** any time to set it up.', embeds: [], components: [] });
    }

    // ── Setup wizard buttons ──────────────────────────────────────────────────
    const session = pendingSetups.get(userId);

    if (id.startsWith('vsetup_method_') && id.endsWith(`_${userId}`)) {
        if (!session) return interaction.reply({ content: '❌ No active setup. Run `/setup verification` to start.', flags: 64 });
        const method = id.replace(`vsetup_method_`, '').replace(`_${userId}`, '');
        session.method = method;
        session.step = 'pick_roles';
        pendingSetups.set(userId, session);
        return sendStep(interaction, session);
    }

    if (id === `vsetup_enterroles_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_roles_${userId}`).setTitle('Roles to Assign');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('role_ids').setLabel('Role IDs (comma-separated)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 123456789, 987654321').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterchannel_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_channel_${userId}`).setTitle('Verification Channel');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setPlaceholder('Right-click the channel → Copy ID').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterfields_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_fields_${userId}`).setTitle('Format Fields');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('fields').setLabel('Fields (one per line)').setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Roblox Username\nDiscord Username\nRank\nProof of Invite').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterdmq_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_dmq_${userId}`).setTitle('DM Questions');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('questions').setLabel('Questions (one per line, max 10)').setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('What is your Roblox username?\nWhat rank do you hold?\nWhy do you want to join?').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterapprole_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_approle_${userId}`).setTitle('Approver Role');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('role_id').setLabel('Approver Role ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterreviewch_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_reviewch_${userId}`).setTitle('Review Channel');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Review Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterlogch_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_logch_${userId}`).setTitle('Log Channel');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_id').setLabel('Log Channel ID').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_enterdesc_${userId}`) {
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_desc_${userId}`).setTitle('Embed Description');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome! Click below to verify.').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    // ── Rank category buttons ─────────────────────────────────────────────────
    if (id === `vsetup_addrank_${userId}`) {
        if (!session) return;
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_addrank_${userId}`).setTitle('Add Rank Category');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('rank_name').setLabel('Rank Name (e.g. SHR, HR, MR)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('rank_role').setLabel('Role — paste ID or mention (e.g. @HR)').setStyle(TextInputStyle.Short)
                    .setPlaceholder('123456789012345678 or @RoleName').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    if (id === `vsetup_rankdone_${userId}` || id === `vsetup_skipranks_${userId}`) {
        if (!session) return;
        if (id === `vsetup_skipranks_${userId}`) session.rankCategories = [];
        session.step = 'pick_notify_role';
        pendingSetups.set(userId, session);
        return sendStep(interaction, session);
    }

    if (id === `vsetup_enternotifyrole_${userId}`) {
        if (!session) return;
        const modal = new ModalBuilder().setCustomId(`vsetup_modal_notifyrole_${userId}`).setTitle('Notify Role');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('role_id').setLabel('Role — paste ID or mention (e.g. @Staff)').setStyle(TextInputStyle.Short)
                .setPlaceholder('123456789012345678 or @RoleName').setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (id === `vsetup_skipnotify_${userId}`) {
        if (!session) return;
        session.notifyRoleId = null;
        session.step = 'pick_embed_desc';
        pendingSetups.set(userId, session);
        return sendStep(interaction, session);
    }

    if (id === `vsetup_skipdesc_${userId}`) {
        if (!session) return;
        await interaction.deferUpdate();
        return finishSetup(interaction, session, client);
    }

    if (id === `vsetup_strict_yes_${userId}`) {
        if (!session) return;
        session.formatStrict = true;
        session.step = 'pick_format_fields';
        pendingSetups.set(userId, session);
        return sendStep(interaction, session);
    }

    if (id === `vsetup_strict_no_${userId}`) {
        if (!session) return;
        session.formatStrict = false;
        session.step = 'pick_approval_role';
        pendingSetups.set(userId, session);
        return sendStep(interaction, session);
    }

    // ── Setup wizard MODALS ───────────────────────────────────────────────────
    if (interaction.isModalSubmit?.()) {
        if (id === `vsetup_modal_roles_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired. Run `/setup verification` again.', flags: 64 });
            const raw = interaction.fields.getTextInputValue('role_ids');
            session.roleIds = raw.split(',').map(s => s.trim()).filter(Boolean);
            // After roles: for button/slash → channel; for dm → dm questions; for format → channel then strictness
            session.step = 'pick_channel';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Roles saved: ${session.roleIds.map(r => `<@&${r}>`).join(', ')}`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_channel_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            session.channelId = interaction.fields.getTextInputValue('channel_id').trim();
            // Route next step by method
            if (session.method === 'button' || session.method === 'slash') {
                // button/slash skip approval flow → go straight to rank categories
                session.step = 'pick_rank_categories';
            } else if (session.method === 'dm') {
                session.step = 'pick_dm_questions';
            } else if (session.method === 'format') {
                session.step = 'pick_format_strictness';
            }
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Channel saved: <#${session.channelId}>`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_dmq_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            const raw = interaction.fields.getTextInputValue('questions');
            session.dmQuestions = raw.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10);
            session.step = 'pick_approval_role';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ ${session.dmQuestions.length} question(s) saved.`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_fields_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            const raw = interaction.fields.getTextInputValue('fields');
            session.formatFields = raw.split('\n').map(s => s.trim()).filter(Boolean);
            session.step = 'pick_approval_role';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Fields saved: ${session.formatFields.join(', ')}`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_approle_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            session.approvalRoleId = interaction.fields.getTextInputValue('role_id').trim();
            session.step = 'pick_review_channel';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Approver role saved: <@&${session.approvalRoleId}>`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_reviewch_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            session.reviewChannelId = interaction.fields.getTextInputValue('channel_id').trim();
            session.step = 'pick_log_channel';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Review channel saved: <#${session.reviewChannelId}>`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_logch_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            session.logChannelId = interaction.fields.getTextInputValue('channel_id').trim();
            session.step = 'pick_rank_categories';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Log channel saved: <#${session.logChannelId}>`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        // Also route button/slash method (which skips approval flow) to rank categories before embed desc
        // This is handled via pick_channel modal → pick_embed_desc route below ↓

        if (id === `vsetup_modal_addrank_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            const rankName = interaction.fields.getTextInputValue('rank_name').trim();
            const roleRaw  = interaction.fields.getTextInputValue('rank_role').trim();
            // Accept role mention <@&123> or bare ID
            const roleId = roleRaw.replace(/[^0-9]/g, '');
            if (!roleId) return interaction.reply({ content: '❌ Couldn\'t parse a role ID from that. Try pasting the role ID directly.', flags: 64 });
            if (!session.rankCategories) session.rankCategories = [];
            session.rankCategories.push({ name: rankName, roleId });
            session.step = 'pick_rank_categories'; // stay on same step to add more
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Added rank **${rankName}** → <@&${roleId}>`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_notifyrole_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            const roleRaw = interaction.fields.getTextInputValue('role_id').trim();
            const roleId = roleRaw.replace(/[^0-9]/g, '');
            if (!roleId) return interaction.reply({ content: '❌ Couldn\'t parse a role ID. Try pasting the role ID directly.', flags: 64 });
            session.notifyRoleId = roleId;
            session.step = 'pick_embed_desc';
            pendingSetups.set(userId, session);
            await interaction.reply({ content: `✅ Notify role set: <@&${roleId}>`, flags: 64 });
            return sendStep(interaction, session, false);
        }

        if (id === `vsetup_modal_desc_${userId}`) {
            if (!session) return interaction.reply({ content: '❌ Session expired.', flags: 64 });
            session.embedDescription = interaction.fields.getTextInputValue('description');
            await interaction.deferReply({ flags: 64 });
            return finishSetup(interaction, session, client);
        }
    }

    // ── Rank selection (select menu on verify embed) ──────────────────────────
    if (id.startsWith('verify_pick_rank_')) {
        const guildId = id.replace('verify_pick_rank_', '');
        await interaction.deferReply({ flags: 64 });
        const config = await VerifyConfig.findOne({ guildId });
        if (!config) return interaction.editReply({ content: '❌ Config not found.' });

        const selectedRoleId = interaction.values?.[0];
        const rankEntry = config.rankCategories?.find(c => c.roleId === selectedRoleId);
        if (!rankEntry) return interaction.editReply({ content: '❌ Unknown rank selection.' });

        // Store pending rank pick
        pendingRankPick.set(userId, {
            config,
            guildId,
            rankName: rankEntry.name,
            rankRoleId: selectedRoleId
        });

        return interaction.editReply({ content: `✅ Rank **${rankEntry.name}** selected! Now proceed with verification.` });
    }

    // ── Instant verify (button method) ────────────────────────────────────────
    if (id.startsWith('verify_click_')) {
        const guildId = id.replace('verify_click_', '');
        await interaction.deferReply({ flags: 64 });
        const config = await VerifyConfig.findOne({ guildId });
        if (!config || config.method !== 'button') return interaction.editReply({ content: '❌ Verification isn\'t configured correctly.' });

        // Pick up any pending rank selection
        const rankPick = pendingRankPick.get(userId);
        const rankRoleId = (rankPick?.guildId === guildId) ? rankPick.rankRoleId : null;
        if (config.rankCategories?.length && !rankRoleId) {
            return interaction.editReply({ content: '⚠️ Please select your rank from the dropdown before clicking Verify.' });
        }
        if (rankRoleId) pendingRankPick.delete(userId);
        return doVerify(interaction, config, client, rankRoleId);
    }

    // ── DM method — start ─────────────────────────────────────────────────────
    if (id.startsWith('verify_dm_start_')) {
        const guildId = id.replace('verify_dm_start_', '');
        const config = await VerifyConfig.findOne({ guildId });
        if (!config || config.method !== 'dm') return;

        const member = interaction.member;
        const hasAll = config.roleIds.every(rid => member.roles.cache.has(rid));
        if (hasAll) return interaction.reply({ content: '✅ You\'re already verified!', flags: 64 });

        if (!config.dmQuestions?.length) return interaction.reply({ content: '❌ No questions configured — contact a staff member.', flags: 64 });

        // Pick up rank selection if present
        const rankPick = pendingRankPick.get(userId);
        const rankRoleId = (rankPick?.guildId === guildId) ? rankPick.rankRoleId : null;
        const rankName   = rankRoleId ? rankPick.rankName : null;
        if (config.rankCategories?.length && !rankRoleId) {
            return interaction.reply({ content: '⚠️ Please select your rank from the dropdown before starting verification.', flags: 64 });
        }
        if (rankRoleId) pendingRankPick.delete(userId);

        // Start DM session (store rank info)
        pendingDMVerify.set(userId, { config, guildId, answers: [], qIndex: 0, rankName, rankRoleId });

        try {
            const dmChannel = await interaction.user.createDM();
            await dmChannel.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x7c3aed)
                    .setTitle('🔐 Verification')
                    .setDescription(`**Question 1 of ${config.dmQuestions.length}:**\n${config.dmQuestions[0]}`)
                    .setFooter({ text: 'Answer in this DM. Type your response and send it.' })]
            });
            return interaction.reply({ content: '📬 Check your DMs! I\'ve sent you the first question.', flags: 64 });
        } catch {
            return interaction.reply({ content: '❌ I couldn\'t DM you. Please open your DMs and try again.', flags: 64 });
        }
    }

    // ── Approval buttons ──────────────────────────────────────────────────────
    if (id.startsWith('verify_approve_') || id.startsWith('verify_deny_')) {
        const isApprove = id.startsWith('verify_approve_');
        const reqId = id.replace('verify_approve_', '').replace('verify_deny_', '');
        await interaction.deferUpdate();
        const { VerifyRequest } = db();
        const req = await VerifyRequest.findById(reqId);
        if (!req) return interaction.followUp({ content: '❌ Request not found.', flags: 64 });
        if (req.status !== 'pending') return interaction.followUp({ content: '⚠️ This request was already handled.', flags: 64 });

        const config = await VerifyConfig.findOne({ guildId: req.guildId });
        if (!config) return interaction.followUp({ content: '❌ Verify config not found.', flags: 64 });

        // Check approver role
        if (config.approvalRoleId && !interaction.member.roles.cache.has(config.approvalRoleId) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.followUp({ content: '❌ You don\'t have permission to handle verification requests.', flags: 64 });
        }

        await VerifyRequest.findByIdAndUpdate(reqId, {
            status: isApprove ? 'approved' : 'denied',
            handledBy: interaction.user.id,
            handledByTag: interaction.user.tag,
            handledAt: new Date()
        });

        if (isApprove) {
            const guild = client.guilds.cache.get(req.guildId);
            if (guild) {
                const member = await guild.members.fetch(req.userId).catch(() => null);
                if (member) {
                    for (const rid of config.roleIds) await member.roles.add(rid).catch(() => {});
                    // Assign rank role if one was selected
                    if (req.rankRoleId) await member.roles.add(req.rankRoleId).catch(() => {});
                }
            }
        }

        // Log it
        if (config.logChannelId) {
            const logCh = await client.channels.fetch(config.logChannelId).catch(() => null);
            if (logCh) {
                let logDesc = `**User:** <@${req.userId}> (${req.userTag})\n**By:** ${interaction.user.tag}`;
                if (req.rankName) logDesc += `\n**Rank:** ${req.rankName}`;
                const logEmbed = new EmbedBuilder()
                    .setColor(isApprove ? 0x22c55e : 0xef4444)
                    .setTitle(isApprove ? '✅ Verification Approved' : '❌ Verification Denied')
                    .setDescription(logDesc)
                    .setTimestamp();
                // Ping notify role on log
                const notifyPing = isApprove && config.notifyRoleId ? `<@&${config.notifyRoleId}>` : undefined;
                await logCh.send({ content: notifyPing, embeds: [logEmbed] });
            }
        }

        // DM the user
        try {
            const target = await client.users.fetch(req.userId);
            const imgBuf = isApprove ? await generateVerifyCard(config.guildName).catch(() => null) : null;
            await target.send({
                content: isApprove
                    ? `✅ Your verification in **${config.guildName}** has been **approved**!`
                    : `❌ Your verification in **${config.guildName}** has been **denied**. Please contact a staff member if you have questions.`,
                ...(imgBuf ? { files: [{ attachment: imgBuf, name: 'verified.png' }] } : {})
            });
        } catch { /* DMs closed */ }

        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(isApprove ? 0x22c55e : 0xef4444)
                .setTitle(isApprove ? '✅ Approved' : '❌ Denied')
                .setDescription(`Handled by ${interaction.user.tag}`)
                .setTimestamp()],
            components: []
        });
    }

    return false; // not handled
}

// ─────────────────────────────────────────────────────────────
// MESSAGE HANDLER  (for channel-format and DM-question methods)
// ─────────────────────────────────────────────────────────────

async function handleVerificationMessage(message, client) {
    if (message.author.bot) return false;
    const { VerifyConfig } = db();

    // ── DM: answer to verify questions ───────────────────────────────────────
    if (!message.guild) {
        const dmSession = pendingDMVerify.get(message.author.id);
        if (!dmSession) return false;

        const { config, guildId } = dmSession;
        dmSession.answers.push(message.content);
        dmSession.qIndex++;

        if (dmSession.qIndex < config.dmQuestions.length) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x7c3aed)
                    .setTitle('🔐 Verification')
                    .setDescription(`**Question ${dmSession.qIndex + 1} of ${config.dmQuestions.length}:**\n${config.dmQuestions[dmSession.qIndex]}`)],
                allowedMentions: { repliedUser: false }
            });
        } else {
            // All answered — submit
            pendingDMVerify.delete(message.author.id);
            await message.reply({ content: '✅ All questions answered! Your verification has been submitted for review.', allowedMentions: { repliedUser: false } });
            await sendApprovalRequest(client, config, message.author.id, message.author.tag, guildId, dmSession.answers, null, dmSession.rankName || null, dmSession.rankRoleId || null);
        }
        return true;
    }

    // ── Channel format method ─────────────────────────────────────────────────
    const config = await VerifyConfig.findOne({ guildId: message.guild.id, method: 'format' }).catch(() => null);
    if (!config || config.channelId !== message.channel.id) return false;

    // Check already verified
    const member = message.member;
    const hasAll = config.roleIds.every(rid => member?.roles.cache.has(rid));
    if (hasAll) {
        await message.reply({ content: '✅ You\'re already verified!', allowedMentions: { repliedUser: false } });
        return true;
    }

    // Strict check
    if (config.formatStrict && config.formatFields?.length) {
        const content = message.content;
        const missing = config.formatFields.filter(field => {
            const regex = new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            return !regex.test(content);
        });
        if (missing.length) {
            await message.reply({
                content: `❌ Your verification is missing required fields:\n${missing.map(f => `• **${f}**`).join('\n')}\n\nPlease re-submit with the correct format.`,
                allowedMentions: { repliedUser: false }
            });
            return true;
        }
    }

    // Pull in any pending rank selection
    const rankPick = pendingRankPick.get(message.author.id);
    const rankRoleId = (rankPick?.guildId === message.guild.id) ? rankPick.rankRoleId : null;
    const rankName   = rankRoleId ? rankPick.rankName : null;
    if (rankRoleId) pendingRankPick.delete(message.author.id);

    if (config.rankCategories?.length && !rankRoleId) {
        await message.reply({ content: '⚠️ Please select your rank from the dropdown in the verify channel before submitting.', allowedMentions: { repliedUser: false } });
        return true;
    }

    // Send for approval
    await sendApprovalRequest(client, config, message.author.id, message.author.tag, message.guild.id, [message.content], null, rankName, rankRoleId);
    await message.reply({ content: '📋 Your verification has been submitted for staff review!', allowedMentions: { repliedUser: false } });
    return true;
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
    // Slash command data for registration
    commands: [setupVerificationCommand, verifyCommand],
    // Main interaction handler
    handleVerificationInteraction,
    // Message handler (DM answers + channel format)
    handleVerificationMessage,
    // Call once from ready event
    sendOneTimePings
};