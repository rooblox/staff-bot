const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1493354187109433434';
const MAIN_GUILD_ID = '1370892833182974035';

const DEPARTMENTS = [
  { name: 'SHR', value: 'SHR' },
  { name: 'PR Member', value: 'PR Member' },
  { name: 'MR Member', value: 'MR Member' },
  { name: 'HR Member', value: 'HR Member' },
  { name: 'Media Team', value: 'Media Team' },
  { name: 'Development Member', value: 'Development Member' },
  { name: 'Development Tester', value: 'Development Tester' },
  { name: 'Human Resources', value: 'Human Resources' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('terminate')
    .setDescription('Terminate a staff member')
    .addUserOption(option =>
      option.setName('user').setDescription('Staff member to terminate').setRequired(true))
    .addStringOption(option =>
      option.setName('rank').setDescription('User rank').setRequired(true))
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for termination').setRequired(true))
    .addStringOption(option =>
      option.setName('appealable').setDescription('Is this termination appealable?').setRequired(true)
        .addChoices({ name: 'Yes', value: 'Yes' }, { name: 'No', value: 'No' }))
    .addStringOption(option =>
      option.setName('department').setDescription('Your department').setRequired(true).addChoices(...DEPARTMENTS))
    .addStringOption(option =>
      option.setName('proof').setDescription('Proof (optional)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID);
      const mainMember = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
      if (!mainMember || !mainMember.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const logChannelID = process.env.LOG_CHANNEL_ID;
      const user = interaction.options.getUser('user');
      const rank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason');
      const appealable = interaction.options.getString('appealable');
      const department = interaction.options.getString('department');
      const proof = interaction.options.getString('proof') || 'Not provided';

      const today = new Date();
      const date = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).slice(-2)}`;

      let record = await StaffRecord.findById(user.id);
      if (!record) {
        record = new StaffRecord({ _id: user.id, rank, strikes: [], terminations: [], blacklists: [] });
      }

      record.rank = rank;
      record.terminations.push({
        reason,
        date: new Date().toISOString(),
        addedBy: { id: interaction.user.id, username: interaction.user.username },
        proof,
        removed: false
      });

      await record.save();

      const dmMessage = `# <:kaviacafe:1387492814916685845> | Termination Notice
-# ${date}
Hello ${user},
Following review, you have been **Terminated** effective immediately. This decision was reached after careful consideration and is intended to address your actions at Kavià. We ask that you reflect on the circumstances that led to this action and cooperate with any actions we need you to take.
Please allow time for staff to complete the rank change. Do **not** leave any servers you are currently a member of while the change is in progress.
> **Reason →** *${reason}*
> **Appealable →** *${appealable}*
If this termination is appealable, and you wish to appeal it please open a ticket in the appeals server. A staff member will review your appeal and respond in a timely manner.
<:reply:1467007523981627392> This action was discussed and approved by members of the SHR+ team and was not taken on a personal bias.
***Sincerely,***
**${interaction.user.username} || ${department}**`;

      try { await user.send({ content: dmMessage }); } catch {}

      const embed = new EmbedBuilder()
        .setTitle('⚡ Staff Terminated')
        .setDescription('A staff member has been terminated.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Terminated', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '🏢 Department', value: department },
          { name: '📝 Reason', value: reason },
          { name: '⚖️ Appealable', value: appealable },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] });

      await interaction.editReply({ content: `✅ ${user.tag} has been terminated.` });

    } catch (err) {
      console.error('Error in /terminate command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};