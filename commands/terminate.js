const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const STAFF_FILE = path.join(__dirname, '../staffDiscipline.json'); // Shared cache

module.exports = {
  data: new SlashCommandBuilder()
    .setName('terminate')
    .setDescription('Terminate a staff member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to terminate')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('User rank')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for termination')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Proof (optional)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const staffRoleID = process.env.STAFF_ROLE_ID;
      const logChannelID = process.env.LOG_CHANNEL_ID;

      if (!interaction.member.roles.cache.has(staffRoleID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const user = interaction.options.getUser('user');
      const rank = interaction.options.getString('rank');
      const reason = interaction.options.getString('reason');
      const proof = interaction.options.getString('proof') || 'Not provided';

      const cache = interaction.client.staffDisciplineCache;

      if (!cache[user.id]) cache[user.id] = {};
      if (!cache[user.id].strikes) cache[user.id].strikes = [];
      if (!cache[user.id].terminations) cache[user.id].terminations = [];
      if (!cache[user.id].blacklists) cache[user.id].blacklists = [];

      cache[user.id].rank = rank;

      cache[user.id].terminations.push({
        reason,
        date: new Date().toISOString(),
        addedBy: {
          id: interaction.user.id,
          username: interaction.user.username
        },
        proof,
        removed: false
      });

      fs.writeFileSync(STAFF_FILE, JSON.stringify(cache, null, 2));

      // ===== DM the terminated user =====
      const dmMessage = `# 📢 Termination Notice

Greetings, ${user},

We regret to inform you that you have been **terminated** from **Kavià Café**.

> 🗒️ Reason: **${reason}**

If you wish to appeal this decision, please open a support ticket in our main server.

*Signed,*
**${interaction.user.username}**
|| ***Human Resources Department***`;

      try { await user.send({ content: dmMessage }); } catch {}

      // ===== RED TERMINATION LOG EMBED =====
      const embed = new EmbedBuilder()
        .setTitle('⚡ Staff Terminated')
        .setDescription('A staff member has been terminated.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Staff Member Terminated', value: user.username },
          { name: '🏷️ Rank', value: rank },
          { name: '📝 Reason', value: reason },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      }

      await interaction.editReply({ content: `✅ ${user.tag} has been terminated.` });

    } catch (err) {
      console.error('Error in /terminate command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};
