/**
 * appbuilder.js — DM-based application question builder
 *
 * Flow:
 *   /appbuilder create <name>  — start a new form's question set via DM
 *   /appbuilder edit <name>    — edit an existing form's questions via DM
 *
 * Per question the user can configure:
 *   • Question text (typed in DM)
 *   • Type: Text / Scale (1-10) / Choice (buttons)
 *   • Min word count (optional)
 *   • Hint/description shown to applicant (optional)
 *   • Required toggle
 *
 * Questions are saved to the existing AppForm model in db.js.
 */

const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, PermissionFlagsBits
} = require('discord.js');

// ─── In-memory sessions ───────────────────────────────────────────────────────
// userId → { formId, formName, questions[], currentQ{}, step, remindAt? }
const builderSessions = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function builderEmbed(title, desc, color = 0x5865f2) {
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
}

function questionPreviewText(q, index) {
    const num = index + 1;
    const type = q.type === 'scale' ? '🔢 Scale (1–10)' :
                 q.type === 'choice' ? `🔘 Choice (${q.choices.join(' | ')})` : '💬 Text';
    const minWords = q.minWords ? `\n> 📏 Min words: **${q.minWords}**` : '';
    const hint = q.hint ? `\n> 💡 Hint: *${q.hint}*` : '';
    const req = q.required ? '' : '\n> *(optional)*';
    return `**Q${num}.** ${q.text}\n> ${type}${minWords}${hint}${req}`;
}

function fullPreviewEmbed(session) {
    const lines = session.questions.map((q, i) => questionPreviewText(q, i));
    return new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`📋 Preview — ${session.formName}`)
        .setDescription(lines.join('\n\n') || '*No questions yet.*')
        .setFooter({ text: `${session.questions.length} question${session.questions.length !== 1 ? 's' : ''}` });
}

// ─── DM step senders ──────────────────────────────────────────────────────────

async function sendGreeting(user, session) {
    const embed = builderEmbed(
        '👋 Welcome to the Application Builder!',
        [
            `You're about to build the questions for **${session.formName}**.`,
            '',
            '**Here\'s how it works:**',
            '1. I\'ll ask you to type each question one at a time',
            '2. After each question you\'ll set the type, min word count, and a hint if needed',
            '3. When you\'re done, I\'ll show you a full preview and you can save or make changes',
            '',
            '> You can type **cancel** at any time to stop without saving.',
            '> You can type **done** when you\'ve added all your questions.',
            '',
            'Ready to begin?'
        ].join('\n')
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_start_${user.id}`)
            .setLabel('✅ Let\'s go!')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`ab_remind_${user.id}`)
            .setLabel('⏰ Remind me later')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`ab_cancel_${user.id}`)
            .setLabel('❌ Never mind')
            .setStyle(ButtonStyle.Danger)
    );

    const dm = await user.createDM();
    return dm.send({ embeds: [embed], components: [row] });
}

async function sendAskQuestion(dmChannel, session) {
    const num = session.questions.length + 1;
    const embed = builderEmbed(
        `➕ Question ${num}`,
        [
            `Type your **Question ${num}** below and send it as a message.`,
            '',
            '**Tips:**',
            '• Keep it clear and concise',
            '• You\'ll be able to set type, min words, and a hint after',
            '',
            'When you\'ve added all questions, type **done**.',
            'Type **cancel** to stop without saving.'
        ].join('\n')
    );

    return dmChannel.send({ embeds: [embed] });
}

async function sendQuestionOptions(dmChannel, userId, questionText) {
    const embed = builderEmbed(
        '✏️ Configure This Question',
        [
            `**Your question:**`,
            `> ${questionText}`,
            '',
            'What **type** of answer should this question accept?'
        ].join('\n')
    );

    const typeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_type_text_${userId}`)
            .setLabel('💬 Text (typed answer)')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`ab_type_scale_${userId}`)
            .setLabel('🔢 Scale (1–10)')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`ab_type_choice_${userId}`)
            .setLabel('🔘 Choice (buttons)')
            .setStyle(ButtonStyle.Secondary)
    );

    return dmChannel.send({ embeds: [embed], components: [typeRow] });
}

async function sendTextOptions(dmChannel, userId, session) {
    const embed = builderEmbed(
        '📏 Text Options',
        [
            `**Question:** ${session.currentQ.text}`,
            '',
            'Would you like to set a **minimum word count**?',
            'This forces applicants to write more than a one-word answer.'
        ].join('\n')
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_minwords_set_${userId}`)
            .setLabel('📏 Set min words')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`ab_minwords_skip_${userId}`)
            .setLabel('⏭️ No minimum')
            .setStyle(ButtonStyle.Secondary)
    );

    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendHintStep(dmChannel, userId, session) {
    const embed = builderEmbed(
        '💡 Add a Hint (optional)',
        [
            `**Question:** ${session.currentQ.text}`,
            '',
            'Would you like to add a **hint** shown to applicants under this question?',
            'Example: *"Be specific — at least 3 sentences."*'
        ].join('\n')
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_hint_set_${userId}`)
            .setLabel('💡 Add hint')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`ab_hint_skip_${userId}`)
            .setLabel('⏭️ No hint')
            .setStyle(ButtonStyle.Secondary)
    );

    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendRequiredStep(dmChannel, userId, session) {
    const embed = builderEmbed(
        '❓ Required?',
        [
            `**Question:** ${session.currentQ.text}`,
            '',
            'Should applicants be **required** to answer this question?'
        ].join('\n')
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_req_yes_${userId}`)
            .setLabel('✅ Required')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`ab_req_no_${userId}`)
            .setLabel('⏭️ Optional')
            .setStyle(ButtonStyle.Secondary)
    );

    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendQuestionConfirm(dmChannel, userId, session) {
    const q = session.currentQ;
    const embed = builderEmbed(
        '✅ Question Preview',
        [
            questionPreviewText(q, session.questions.length),
            '',
            'Does this look right?'
        ].join('\n'),
        0x2ecc71
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_qconfirm_yes_${userId}`)
            .setLabel('✅ Save this question')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`ab_qconfirm_redo_${userId}`)
            .setLabel('🔄 Redo this question')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`ab_qconfirm_done_${userId}`)
            .setLabel('🏁 Done — no more questions')
            .setStyle(ButtonStyle.Primary)
    );

    return dmChannel.send({ embeds: [embed], components: [row] });
}

async function sendFinalPreview(dmChannel, userId, session) {
    const embed = fullPreviewEmbed(session);
    embed.setTitle(`📋 Final Preview — ${session.formName}`);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ab_save_${userId}`)
            .setLabel('💾 Save & finish')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`ab_addmore_${userId}`)
            .setLabel('➕ Add more questions')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`ab_editq_${userId}`)
            .setLabel('✏️ Edit a question')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`ab_cancel_${userId}`)
            .setLabel('🗑️ Discard')
            .setStyle(ButtonStyle.Danger)
    );

    return dmChannel.send({ embeds: [embed], components: [row] });
}

// ─── Interaction handler ──────────────────────────────────────────────────────

async function handleBuilderInteraction(interaction, client) {
    const id = interaction.customId;
    if (!id?.startsWith('ab_')) return false;

    const userId = interaction.user.id;
    const session = builderSessions.get(userId);

    // ── Greeting buttons ──────────────────────────────────────────────────────

    if (id === `ab_start_${userId}`) {
        if (!session) return interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Your builder session expired. Run the command again.')], components: [] });
        await interaction.update({ embeds: [builderEmbed('✅ Let\'s go!', 'I\'ll guide you through each question. Type your first question below.')], components: [] });
        session.step = 'awaiting_question';
        const dm = await interaction.user.createDM();
        await sendAskQuestion(dm, session);
        return true;
    }

    if (id === `ab_remind_${userId}`) {
        if (!session) return interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Run the command again.')], components: [] });
        // Store remind intent — remind after 1 hour via DM
        session.remindAt = Date.now() + 60 * 60 * 1000;
        builderSessions.set(userId, session);
        await interaction.update({
            embeds: [builderEmbed('⏰ Reminder Set', 'I\'ll send you a reminder in **1 hour** to come back and build your questions.')],
            components: []
        });
        setTimeout(async () => {
            try {
                const s = builderSessions.get(userId);
                if (!s || s.step !== 'reminded') return; // already started or cancelled
                const dm = await interaction.user.createDM();
                await sendGreeting(interaction.user, s);
                s.step = 'greeting';
                builderSessions.set(userId, s);
            } catch {}
        }, 60 * 60 * 1000);
        session.step = 'reminded';
        return true;
    }

    if (id === `ab_cancel_${userId}`) {
        builderSessions.delete(userId);
        await interaction.update({
            embeds: [builderEmbed('❌ Cancelled', 'No changes were saved. Run the command again whenever you\'re ready.', 0xe74c3c)],
            components: []
        });
        return true;
    }

    if (!session) {
        await interaction.update({ embeds: [builderEmbed('⚠️ Session Expired', 'Your builder session expired. Run the command again.')], components: [] }).catch(() => {});
        return true;
    }

    // ── Question type ──────────────────────────────────────────────────────────

    if (id === `ab_type_text_${userId}`) {
        session.currentQ.type = 'text';
        await interaction.update({ embeds: [builderEmbed('💬 Text selected', `**Question:** ${session.currentQ.text}\n\nGreat — applicants will type a free-form answer.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendTextOptions(dm, userId, session);
        return true;
    }

    if (id === `ab_type_scale_${userId}`) {
        session.currentQ.type = 'scale';
        session.currentQ.choices = [];
        await interaction.update({ embeds: [builderEmbed('🔢 Scale selected', `**Question:** ${session.currentQ.text}\n\nApplicants will pick a number from 1–10.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendHintStep(dm, userId, session);
        return true;
    }

    if (id === `ab_type_choice_${userId}`) {
        session.currentQ.type = 'choice';
        session.step = 'awaiting_choices';
        await interaction.update({ embeds: [builderEmbed('🔘 Choice selected', `**Question:** ${session.currentQ.text}\n\nType the choices separated by **|** (pipe).\n\nExample: \`Yes | No | Maybe\``)], components: [] });
        return true;
    }

    // ── Min words ──────────────────────────────────────────────────────────────

    if (id === `ab_minwords_set_${userId}`) {
        session.step = 'awaiting_minwords';
        await interaction.update({ embeds: [builderEmbed('📏 Min Words', 'Type the **minimum word count** for this question (e.g. `50`).')], components: [] });
        return true;
    }

    if (id === `ab_minwords_skip_${userId}`) {
        session.currentQ.minWords = null;
        await interaction.update({ embeds: [builderEmbed('⏭️ No minimum', 'No word minimum set.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendHintStep(dm, userId, session);
        return true;
    }

    // ── Hint ──────────────────────────────────────────────────────────────────

    if (id === `ab_hint_set_${userId}`) {
        session.step = 'awaiting_hint';
        await interaction.update({ embeds: [builderEmbed('💡 Add Hint', 'Type the hint text to show applicants under this question.')], components: [] });
        return true;
    }

    if (id === `ab_hint_skip_${userId}`) {
        session.currentQ.hint = null;
        await interaction.update({ embeds: [builderEmbed('⏭️ No hint', 'No hint set.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendRequiredStep(dm, userId, session);
        return true;
    }

    // ── Required ──────────────────────────────────────────────────────────────

    if (id === `ab_req_yes_${userId}`) {
        session.currentQ.required = true;
        await interaction.update({ embeds: [builderEmbed('✅ Marked as required', 'Applicants must answer this question.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendQuestionConfirm(dm, userId, session);
        return true;
    }

    if (id === `ab_req_no_${userId}`) {
        session.currentQ.required = false;
        await interaction.update({ embeds: [builderEmbed('⏭️ Optional', 'Applicants may skip this question.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendQuestionConfirm(dm, userId, session);
        return true;
    }

    // ── Question confirm ──────────────────────────────────────────────────────

    if (id === `ab_qconfirm_yes_${userId}`) {
        session.questions.push({ ...session.currentQ });
        session.currentQ = {};
        session.step = 'awaiting_question';
        await interaction.update({ embeds: [builderEmbed('✅ Question saved!', `You now have **${session.questions.length}** question${session.questions.length !== 1 ? 's' : ''}.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendAskQuestion(dm, session);
        return true;
    }

    if (id === `ab_qconfirm_redo_${userId}`) {
        session.currentQ = {};
        session.step = 'awaiting_question';
        await interaction.update({ embeds: [builderEmbed('🔄 Let\'s redo that', 'Type your question again below.')], components: [] });
        return true;
    }

    if (id === `ab_qconfirm_done_${userId}`) {
        // Don't save this question — go straight to final preview
        session.currentQ = {};
        session.step = 'final_preview';
        await interaction.update({ embeds: [builderEmbed('🏁 All done!', 'Here\'s your full preview.')], components: [] });
        const dm = await interaction.user.createDM();
        await sendFinalPreview(dm, userId, session);
        return true;
    }

    // ── Final preview ─────────────────────────────────────────────────────────

    if (id === `ab_save_${userId}`) {
        if (!session.questions.length) {
            await interaction.update({ embeds: [builderEmbed('⚠️ No questions', 'Add at least one question before saving.')], components: [] });
            return true;
        }
        try {
            const { AppForm } = require('../db');
            await interaction.deferUpdate();
            if (session.formId) {
                // Edit mode — update existing form's questions
                await AppForm.findByIdAndUpdate(session.formId, { questions: session.questions });
            } else {
                // Create mode — create new form skeleton (setup wizard handles servers/channels)
                await AppForm.create({
                    name: session.formName,
                    questions: session.questions,
                    createdBy: userId,
                    logServerId: '', logServerName: '',
                    logChannelId: '', logChannelName: '',
                    ticketServerId: '', ticketServerName: '',
                    ticketChannelId: '', ticketChannelName: '',
                    open: false
                });
            }
            builderSessions.delete(userId);
            const embed = fullPreviewEmbed(session);
            embed.setTitle(`💾 Saved — ${session.formName}`);
            embed.setDescription((embed.data.description || '') + '\n\n✅ Questions saved successfully!' + (session.formId ? '' : '\n\nUse `/application setup` to configure the log channel and ticket settings, then `/application open` to post the Apply button.'));
            await interaction.editReply({ embeds: [embed], components: [] });
        } catch (err) {
            console.error('[appbuilder save]', err);
            await interaction.editReply({ embeds: [builderEmbed('❌ Error', 'Failed to save. Please try again.', 0xe74c3c)], components: [] });
        }
        return true;
    }

    if (id === `ab_addmore_${userId}`) {
        session.step = 'awaiting_question';
        session.currentQ = {};
        await interaction.update({ embeds: [builderEmbed('➕ Adding more', `You have **${session.questions.length}** questions so far. Type your next one below.`)], components: [] });
        const dm = await interaction.user.createDM();
        await sendAskQuestion(dm, session);
        return true;
    }

    if (id === `ab_editq_${userId}`) {
        session.step = 'awaiting_edit_pick';
        const list = session.questions.map((q, i) => `**${i + 1}.** ${q.text}`).join('\n');
        await interaction.update({
            embeds: [builderEmbed('✏️ Edit a Question', `Type the **number** of the question you want to edit:\n\n${list}`)],
            components: []
        });
        return true;
    }

    return false;
}

// ─── DM message handler ───────────────────────────────────────────────────────
// Called from index.js messageCreate for DMs

async function handleBuilderMessage(message, client) {
    if (message.author.bot) return false;
    if (message.guild) return false; // only DMs

    const userId = message.author.id;
    const session = builderSessions.get(userId);
    if (!session) return false;

    const text = message.content.trim();

    // Global cancel/done
    if (text.toLowerCase() === 'cancel') {
        builderSessions.delete(userId);
        await message.reply({ embeds: [builderEmbed('❌ Cancelled', 'No changes were saved.', 0xe74c3c)] });
        return true;
    }

    if (text.toLowerCase() === 'done' && session.step === 'awaiting_question') {
        if (!session.questions.length) {
            await message.reply({ embeds: [builderEmbed('⚠️ No questions yet', 'You need at least one question. Type it below.')] });
            return true;
        }
        session.step = 'final_preview';
        const dm = await message.author.createDM();
        await sendFinalPreview(dm, userId, session);
        return true;
    }

    // ── Awaiting question text ────────────────────────────────────────────────
    if (session.step === 'awaiting_question') {
        if (text.length < 5) {
            await message.reply({ embeds: [builderEmbed('⚠️ Too short', 'Please type a full question.')] });
            return true;
        }
        session.currentQ = { text, type: 'text', choices: [], minWords: null, hint: null, required: true };
        session.step = 'awaiting_type';
        const dm = await message.author.createDM();
        await sendQuestionOptions(dm, userId, text);
        return true;
    }

    // ── Awaiting choices for choice type ─────────────────────────────────────
    if (session.step === 'awaiting_choices') {
        const choices = text.split('|').map(c => c.trim()).filter(Boolean);
        if (choices.length < 2) {
            await message.reply({ embeds: [builderEmbed('⚠️ Need at least 2 choices', 'Separate them with `|` e.g. `Yes | No | Maybe`')] });
            return true;
        }
        session.currentQ.choices = choices.slice(0, 5);
        session.step = 'awaiting_hint_step';
        await message.reply({ embeds: [builderEmbed('✅ Choices saved', `Choices: **${session.currentQ.choices.join(' | ')}**`)] });
        const dm = await message.author.createDM();
        await sendHintStep(dm, userId, session);
        return true;
    }

    // ── Awaiting min words number ─────────────────────────────────────────────
    if (session.step === 'awaiting_minwords') {
        const n = parseInt(text, 10);
        if (isNaN(n) || n < 1 || n > 500) {
            await message.reply({ embeds: [builderEmbed('⚠️ Invalid number', 'Enter a number between 1 and 500.')] });
            return true;
        }
        session.currentQ.minWords = n;
        session.step = 'awaiting_hint_step';
        await message.reply({ embeds: [builderEmbed('✅ Min words set', `Minimum **${n} words** required.`)] });
        const dm = await message.author.createDM();
        await sendHintStep(dm, userId, session);
        return true;
    }

    // ── Awaiting hint text ────────────────────────────────────────────────────
    if (session.step === 'awaiting_hint') {
        session.currentQ.hint = text.slice(0, 200);
        session.step = 'awaiting_required';
        await message.reply({ embeds: [builderEmbed('✅ Hint saved', `Hint: *${session.currentQ.hint}*`)] });
        const dm = await message.author.createDM();
        await sendRequiredStep(dm, userId, session);
        return true;
    }

    // ── Awaiting edit pick (number) ───────────────────────────────────────────
    if (session.step === 'awaiting_edit_pick') {
        const n = parseInt(text, 10);
        if (isNaN(n) || n < 1 || n > session.questions.length) {
            await message.reply({ embeds: [builderEmbed('⚠️ Invalid number', `Pick a number between 1 and ${session.questions.length}.`)] });
            return true;
        }
        const q = session.questions[n - 1];
        session.editIndex = n - 1;
        session.currentQ = { ...q };
        session.questions.splice(n - 1, 1); // remove temporarily
        session.step = 'awaiting_question';
        await message.reply({ embeds: [builderEmbed(`✏️ Editing Q${n}`, `Current text: *${q.text}*\n\nType the new question text below, or type it again to keep it the same.`)] });
        return true;
    }

    return false;
}

// ─── Slash command ────────────────────────────────────────────────────────────

module.exports = {
    builderSessions,
    handleBuilderInteraction,
    handleBuilderMessage,

    data: new SlashCommandBuilder()
        .setName('appbuilder')
        .setDescription('Build or edit an application form\'s questions via DM')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Start a new application form with questions built in DM')
            .addStringOption(o => o
                .setName('name')
                .setDescription('Name for this form e.g. "Barista Application"')
                .setRequired(true)
                .setMaxLength(80)
            )
        )
        .addSubcommand(sub => sub
            .setName('edit')
            .setDescription('Edit the questions on an existing form via DM')
            .addStringOption(o => o
                .setName('form_search')
                .setDescription('Part of the form name')
                .setRequired(true)
                .setMaxLength(80)
            )
        ),

    async execute(interaction) {
        const sub    = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const { AppForm } = require('../db');

        if (sub === 'create') {
            const name = interaction.options.getString('name');

            // Check for duplicate name
            const existing = await AppForm.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
            if (existing) {
                return interaction.reply({
                    content: `❌ A form named **${name}** already exists. Use \`/appbuilder edit\` to edit it, or choose a different name.`,
                    flags: 64
                });
            }

            const session = {
                formId: null,
                formName: name,
                questions: [],
                currentQ: {},
                step: 'greeting'
            };
            builderSessions.set(userId, session);

            await interaction.reply({ content: '📬 Check your DMs — I\'ve sent you the builder!', flags: 64 });
            await sendGreeting(interaction.user, session);
            return;
        }

        if (sub === 'edit') {
            const search = interaction.options.getString('form_search');
            const form = await AppForm.findOne({ name: { $regex: search, $options: 'i' } });
            if (!form) {
                return interaction.reply({ content: `❌ No form found matching **${search}**.`, flags: 64 });
            }

            const session = {
                formId: String(form._id),
                formName: form.name,
                questions: form.questions.map(q => ({ ...q })), // copy
                currentQ: {},
                step: 'greeting'
            };
            builderSessions.set(userId, session);

            await interaction.reply({ content: '📬 Check your DMs — I\'ve sent you the editor!', flags: 64 });

            // For edit, show current questions first then greeting
            const dm = await interaction.user.createDM();
            const previewEmbed = fullPreviewEmbed(session);
            previewEmbed.setTitle(`✏️ Editing — ${form.name}`);
            previewEmbed.setDescription(
                (previewEmbed.data.description || '*No questions yet.*') +
                '\n\nThis is what\'s currently saved. The builder will let you add, edit, or remove questions.'
            );
            await dm.send({ embeds: [previewEmbed] });
            await sendGreeting(interaction.user, session);
        }
    }
};