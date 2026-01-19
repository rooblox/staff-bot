const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const STAFF_FILE = path.join(__dirname, '../staffDiscipline.json'); // Use shared cache

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a staff member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to blacklist')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for blacklist')
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
      const reason = interaction.options.getString('reason');
      const proof = interaction.options.getString('proof') || 'Not provided';

      const cache = interaction.client.staffDisciplineCache;

      if (!cache[user.id]) {
        cache[user.id] = { strikes: [], terminations: [], blacklists: [] };
      }

      if (!cache[user.id].blacklists) {
        cache[user.id].blacklists = [];
      }

      cache[user.id].blacklists.push({
        reason,
        date: new Date().toISOString(),
        addedBy: {
          id: interaction.user.id,
          username: interaction.user.username
        },
        removed: false
      });

      // Save immediately
      fs.writeFileSync(STAFF_FILE, JSON.stringify(cache, null, 2));

      // DM the user
      const dmMessage = `# ⛔ Blacklist Notice

Greetings, ${user},

I regret to inform you that you have been **blacklisted** following actions at **Kavià Café**.

> 🗒️ *Reason:* **${reason}**

If you would like clarification, please open a support ticket in the server.

*Signed,*
**${interaction.user.username}**
|| ***Human Resources Department***`;

      try { await user.send({ content: dmMessage }); } catch {}

      // Log embed
      const embed = new EmbedBuilder()
        .setTitle('⛔ Staff Blacklisted')
        .setDescription('A staff member has been blacklisted.')
        .setColor(0xE74C3C)
        .addFields(
          { name: '👮 Staff User', value: interaction.user.username },
          { name: '⚡ Blacklisted Member', value: user.username },
          { name: '📝 Reason', value: reason },
          { name: '📎 Proof', value: proof }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      const logChannel = await interaction.client.channels.fetch(logChannelID);
      if (logChannel?.isTextBased()) {
        await logChannel.send({ embeds: [embed] });
      }

      await interaction.editReply({ content: `✅ ${user.tag} has been blacklisted.` });

    } catch (err) {
      console.error('Error in /blacklist command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};
