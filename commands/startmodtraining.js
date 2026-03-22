const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const LOG_CHANNEL_ID = '1485349514486480947';
const REQUIRED_ROLE_ID = '1464028127440273458';

const activeSessions = new Map();

const sections = [
  {
    title: '<:emoji_1:1464065515579248854>  Welcome to the Moderation Team',
    content: `Congratulations and welcome to the **Moderation Department** at Kavià Café!\n\nYou have been assigned the role of **Trial Moderator**. At this stage, you will not have any moderation permissions — these will be granted once you have successfully completed your trial.\n\nThis training will walk you through everything you need to know, including our rules, expectations, logging procedures, and the moderation hierarchy. Please read each section carefully before proceeding.\n\n> ⚠️ If you fail this trial, you are permitted to retake it **once**. Failing a second time will result in removal from the Moderation Department. Any misuse of permissions once granted will result in **immediate disciplinary action**.`
  },
  {
    title: '<:emoji_1:1464065515579248854>  Server Rules',
    content: `As a moderator, you must have a thorough understanding of our server rules.\n\n**Harassment & Disrespect**\n> Cyberbullying, inappropriate comments, targeted insults, or any behaviour making members feel unwelcome.\n\n**Discord & Roblox ToS Violations**\n> Scamming, being underage, or engaging in activities prohibited by either platform.\n\n**Chat Flood**\n> Sending 10 or more messages in a row, or repeatedly sending the same message.\n\n**NSFW Content**\n> Sharing inappropriate images, videos, gore, or any explicit content.\n\n**Impersonation**\n> Pretending to be another member, staff member, or public figure.\n\n**Advertisements**\n> Sharing server invite links, asking members to join other servers, or DM advertising.\n\n**Alternative Accounts**\n> If you identify an alt account, you may take action — but please verify before doing so.`
  },
  {
    title: '<:emoji_1:1464065515579248854>  Expectations',
    content: `As a member of the Moderation Department, there is no official activity quota. However, you are still expected to actively perform your duties — prolonged inactivity may result in termination.\n\nModerators and HR staff are held to a higher standard and set the example for MR and LR staff. While you don't need to be extremely formal in general chat, please remain mindful of what you say at all times.\n\n> You are still subject to our standard server rules. Breaking them will result in the appropriate consequences.`
  },
  {
    title: '<:emoji_1:1464065515579248854>  Logging Procedures',
    content: `All moderation actions must be properly logged. Below is a breakdown of each action.\n\n**Warnings**\n> Use proper grammar when issuing a warning. Log all warnings in the designated channel so prior offences can be tracked.\n\n**Timeouts**\n> A lesser punishment but must still be logged. Use the correct format including the reason and duration.\n\n**Kicks**\n> A serious action — do not kick without sufficient proof. Log it in the kick log channel using the correct format.\n\n**Bans**\n> Submit a ban request and wait for approval before proceeding. Once approved, carry out the ban and log it. **Do not ban without prior approval.**\n\n**SHR Rule Violations**\n> Do not handle SHR violations yourself. Escalate immediately to a member of the Presidential team.`
  },
  {
    title: '<:emoji_1:1464065515579248854>  Moderation Hierarchy',
    content: `The Moderation Department has several ranks, each with its own requirements and permissions. Promotions are not guaranteed by time alone — your performance must be recognised by a staff member.\n\n**<:emoji_1:1464065515579248854> Trial Moderator**\n> Starting rank. Timeout permissions only while completing your trial.\n\n**<:emoji_1:1464065515579248854> Junior Moderator**\n> Awarded upon trial completion. Can kick members and delete messages. No ban permissions yet.\n\n**<:emoji_1:1464065515579248854> Moderator**\n> Requires 2 weeks as Junior Moderator. Full permissions — ban, kick, and timeout.\n\n**<:emoji_1:1464065515579248854> Senior Moderator**\n> Requires 2 weeks as Moderator. A more experienced and trusted role.\n\n**<:emoji_1:1464065515579248854> Head Moderator**\n> Highest achievable rank below leadership. Requires 1 week as Senior Moderator.`
  }
];

const quizQuestions = [
  {
    question: 'Which of the following correctly lists the permissions granted to a **Junior Moderator**?',
    options: { A: 'Ban, kick, and timeout members', B: 'Kick members, timeout members, and delete messages', C: 'Ban members only', D: 'No permissions until fully promoted' },
    answer: 'B'
  },
  {
    question: 'A user is actively engaging in hate speech in the server. What is the correct course of action?',
    options: { A: 'Issue a formal warning', B: 'Apply a temporary timeout', C: 'Issue an immediate ban', D: 'Escalate to SHR' },
    answer: 'C'
  },
  {
    question: '**True or False** — As a moderator, you are required to log every moderation action you take.',
    options: { A: 'True', B: 'False', C: null, D: null },
    answer: 'A'
  },
  {
    question: 'At which moderation rank does a staff member first receive **ban permissions**?',
    options: { A: 'Trial Moderator', B: 'Junior Moderator', C: 'Moderator', D: 'Senior Moderator' },
    answer: 'C'
  },
  {
    question: 'A user is directly threatening another member of the server. What must you do?',
    options: { A: 'Issue a warning and monitor the situation', B: 'Apply a timeout until they calm down', C: 'Issue an immediate ban', D: 'Notify SHR and wait for instructions' },
    answer: 'C'
  },
  {
    question: 'What is the **highest rank** achievable within the Moderation Department, below leadership?',
    options: { A: 'Senior Moderator', B: 'Moderator', C: 'Head Moderator', D: 'Junior Moderator' },
    answer: 'C'
  },
  {
    question: '**True or False** — Moderators are not expected to follow the same rules as regular members.',
    options: { A: 'True', B: 'False', C: null, D: null },
    answer: 'B'
  },
  {
    question: 'What is the correct **prefix** used for moderation commands in this server?',
    options: { A: '!', B: '/', C: '.', D: '?' },
    answer: 'D'
  }
];

const closingNotes = `<:emoji_1:1464065515579248854>  **Closing Notes**\n\nCongratulations on completing your training! This DM will remain active until you have reached the rank of **Moderator**.\n\nDuring this time, you will be guided by your assigned mentor, who is here to support you, answer your questions, and help you grow within the department.\n\nPlease be aware that your mentor has the right to recommend your removal from the Moderation Department at any time if they feel you are not suited for the role. In the unlikely event that this occurs, you will also be asked to step down from the HR team, as switching between departments is not permitted.\n\nWe wish you the very best of luck — we are excited to have you on the team and look forward to seeing you thrive at **Kavià Café**! 🎉`;

function getSectionEmbed(index) {
  const section = sections[index];
  return new EmbedBuilder()
    .setTitle(section.title)
    .setDescription(section.content)
    .setColor(0x3498DB)
    .setFooter({ text: `Section ${index + 1} of ${sections.length} • Kavià Café Moderation Training` })
    .setTimestamp();
}

function getSectionButtons(userId, sectionIndex) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`training_done_${userId}_${sectionIndex}`)
      .setLabel('✅ Done')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`training_help_${userId}_${sectionIndex}`)
      .setLabel('🆘 I Need Help')
      .setStyle(ButtonStyle.Danger)
  );
}

function getQuizEmbed(questionIndex, score) {
  const q = quizQuestions[questionIndex];
  const options = Object.entries(q.options)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `**${k})** ${v}`)
    .join('\n');

  return new EmbedBuilder()
    .setTitle(`<:emoji_1:1464065515579248854>  Test Segment — Question ${questionIndex + 1} of ${quizQuestions.length}`)
    .setDescription(`${q.question}\n\n${options}`)
    .setColor(0x9B59B6)
    .setFooter({ text: `Current Score: ${score}/${questionIndex} • Kavià Café Moderation Training` })
    .setTimestamp();
}

function getQuizButtons(userId, questionIndex) {
  const q = quizQuestions[questionIndex];
  const validOptions = Object.entries(q.options).filter(([, v]) => v !== null);

  const buttons = validOptions.map(([key]) =>
    new ButtonBuilder()
      .setCustomId(`quiz_${key}_${userId}_${questionIndex}`)
      .setLabel(key)
      .setStyle(ButtonStyle.Primary)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
  activeSessions,

  data: new SlashCommandBuilder()
    .setName('startmodtraining')
    .setDescription('Start moderation training for a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to train')
        .setRequired(true)),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
    const roleExists = interaction.guild.roles.cache.has(REQUIRED_ROLE_ID);
    if (roleExists && !member.roles.cache.has(REQUIRED_ROLE_ID)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
    }

    const user = interaction.options.getUser('user');

    if (activeSessions.has(user.id)) {
      return interaction.editReply({ content: `❌ ${user.tag} already has an active training session.` });
    }

    activeSessions.set(user.id, {
      staffId: interaction.user.id,
      guildId: interaction.guild.id,
      section: 0,
      quizIndex: 0,
      score: 0,
      phase: 'sections',
      locked: false,
      client
    });

    try {
      const embed = getSectionEmbed(0);
      const buttons = getSectionButtons(user.id, 0);
      await user.send({ embeds: [embed], components: [buttons] });
      await interaction.editReply({ content: `✅ Training started for ${user.tag}! Sections are being sent to their DMs.` });

      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
      if (logChannel?.isTextBased()) {
        await logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('📚 Training Session Started')
              .setColor(0x3498DB)
              .addFields(
                { name: '👤 Trainee', value: `${user.tag} (${user.id})` },
                { name: '👮 Started By', value: `${interaction.user.tag}` }
              )
              .setTimestamp()
          ]
        });
      }
    } catch (err) {
      activeSessions.delete(user.id);
      await interaction.editReply({ content: `❌ Could not DM ${user.tag}. They may have DMs closed.` });
    }
  },

  getSectionEmbed,
  getSectionButtons,
  getQuizEmbed,
  getQuizButtons,
  quizQuestions,
  sections,
  closingNotes,
  LOG_CHANNEL_ID,
  REQUIRED_ROLE_ID
};