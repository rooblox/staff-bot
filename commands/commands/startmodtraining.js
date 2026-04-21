const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const LOG_CHANNEL_ID = '1485349514486480947';
const REQUIRED_ROLE_ID = '1495951292605009930';
const MAIN_GUILD_ID = '1301333604315561994';

const activeSessions = new Map();

const sections = [
  {
    title: '<:emoji_1:1464065515579248854>  Welcome to Moderation!',
    content: `Hello, and congratulations on passing your application and joining our Moderation Department! During this period, you will receive the trial moderator role as you undergo your mentorship.\n\nThis trial was designed to provide a clear explanation of our policies, expectations, procedures, and logging requirements. If you have any questions at any time, do not hesitate to ask.\n\nWe will now send a series of messages covering everything needed to become an excellent moderator. If you fail your trial you will receive only *one* opportunity to retake it. If you fail twice, you will be removed from the department.\n\nThis trial will be open until you achieve the rank of moderator.`
  },
  {
    title: '<:emoji_1:1464065515579248854>  Rules & Procedures',
    content: `A moderator's main responsibility is to enforce and uphold all rules found within https://discord.com/channels/1370892833182974035/1370946530894413824. When moderating, you should do so fairly, professionally, and respectfully, as this helps keep our community safe and welcoming for everyone.\n\nAll actions should follow the guidelines listed below. Consistency and sound judgment are crucial when handling situations within the server.\n\n> [Kavià Cafe Rules](https://docs.google.com/spreadsheets/d/1cK-QcY_UXiFTCF8IQXlzCQqnz2uklMdHpEDR99oesm0/edit?usp=sharing)\n\nPlease ensure you are familiar with these rules and review the document periodically to stay informed. If you are ever unsure about what action to take, do not hesitate to contact a member of moderation leadership. We'd rather have you ask for help than blindly take action.`
  },
  {
    title: '<:emoji_1:1464065515579248854>  Behavioral Expectations',
    content: `As a moderator, you don't just enforce rules; you're also expected to *follow* them yourself. Your behavior sets the tone for the rest of the server and demonstrates what is acceptable and what is not.\n\nMaintaining positive conduct is just as crucial as enforcing rules on others. After all, who's going to listen to someone who doesn't practice what they preach?\n\nThis policy is especially important in public chat areas. We expect *all* moderators to understand when and where their actions are appropriate.\n\n**Prohibited actions as a moderator:**\n• **Swearing**\n• **Mean-spirited jokes**\n• **Mentions of real-life tragedies in inappropriate contexts**\n• **Disrespect & Drama**\n• **Rank abuse — e.g., threatening members with false punishment**\n\nWhile this list isn't everything, we expect you to use **common sense** to determine what's acceptable. If you think it might cause trouble, don't do it. Failure to do so may result in a strike from leadership.`
  }
];

const quizQuestions = [
  {
    question: 'What is a moderator\'s main responsibility?',
    options: { A: 'Welcoming new members', B: 'Enforce and uphold all server rules', C: 'Managing server channels', D: 'Organizing events' },
    answer: 'B'
  },
  {
    question: 'If you are unsure about what action to take in a situation, what should you do?',
    options: { A: 'Take action anyway', B: 'Ignore the situation', C: 'Contact a member of moderation leadership', D: 'Ask a regular member' },
    answer: 'C'
  },
  {
    question: 'Which of the following is a **prohibited action** as a moderator?',
    options: { A: 'Enforcing rules fairly', B: 'Swearing in chat', C: 'Logging moderation actions', D: 'Asking for help' },
    answer: 'B'
  },
  {
    question: 'How many times can you retake the trial if you fail?',
    options: { A: 'Three times', B: 'Unlimited', C: 'Once', D: 'You cannot retake it' },
    answer: 'C'
  },
  {
    question: '**True or False** — Moderators are expected to follow the same rules as regular members.',
    options: { A: 'True', B: 'False', C: null, D: null },
    answer: 'A'
  },
  {
    question: 'What three qualities should you demonstrate when moderating?',
    options: { A: 'Speed, strictness, and authority', B: 'Fairly, professionally, and respectfully', C: 'Quickly, quietly, and firmly', D: 'Boldly, clearly, and strictly' },
    answer: 'B'
  },
  {
    question: 'What should you do if you think an action might cause trouble?',
    options: { A: 'Do it anyway if you think it\'s right', B: 'Ask a regular member for advice', C: 'Don\'t do it', D: 'Wait and see what happens' },
    answer: 'C'
  },
  {
    question: '**True or False** — Rank abuse, such as threatening members with false punishment, is permitted.',
    options: { A: 'True', B: 'False', C: null, D: null },
    answer: 'B'
  }
];

const closingNotes = `Congratulations on completing your training! This DM will remain active until you have reached the rank of **Moderator**.\n\nDuring this time, you will be guided by your assigned mentor, who is here to support you, answer your questions, and help you grow within the department.\n\nPlease be aware that your mentor has the right to recommend your removal from the Moderation Department at any time if they feel you are not suited for the role. In the unlikely event that this occurs, you will also be asked to step down from the HR team, as switching between departments is not permitted.\n\nWe wish you the very best of luck — we are excited to have you on the team and look forward to seeing you thrive at **Kavià Café**! 🎉`;

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
      option.setName('user').setDescription('User to train').setRequired(true)),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
    const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
    if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
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