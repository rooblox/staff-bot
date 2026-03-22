const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { StaffRecord } = require('../db');

const REQUIRED_ROLE_ID = '1484973859513045224';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staffinfo')
    .setDescription('View a full summary of a staff member')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Staff member to view')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    try {
      const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
      const roleExists = interaction.guild.roles.cache.has(REQUIRED_ROLE_ID);
      if (roleExists && !member.roles.cache.has(REQUIRED_ROLE_ID)) {
        return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
      }

      const user = interaction.options.getUser('user');
      const record = await StaffRecord.findById(user.id);

      if (!record) {
        return interaction.editReply({ content: '❌ No record found for this user.' });
      }

      const activeStrikes = record.strikes?.filter(s => !s.removed) || [];
      const pastStrikes = record.strikes?.filter(s => s.removed) || [];
      const activeTerminations = record.terminations?.filter(t => !t.removed) || [];
      const activeBlacklists = record.blacklists?.filter(b => !b.removed) || [];
      const notes = record.notes || [];

      const embed = new EmbedBuilder()
        .setTitle(`👤 Staff Info — ${user.tag}`)
        .setColor(0x3498DB)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          {
            name: '📋 Basic Info',
            value: `**User:** ${user}\n**Rank:** ${record.rank || 'Not set'}`
          },
          {
            name: `⚠️ Active Strikes (${activeStrikes.length})`,
            value: activeStrikes.length > 0
              ? activeStrikes.map((s, i) => `**#${i + 1}** — ${s.reason} — *${s.date.slice(0, 10)}*`).join('\n')
              : 'None'
          },
          {
            name: `✅ Past Strikes (${pastStrikes.length})`,
            value: pastStrikes.length > 0
              ? pastStrikes.map((s, i) => `**#${i + 1}** — ${s.reason} — *${s.date.slice(0, 10)}*`).join('\n')
              : 'None'
          },
          {
            name: `⚡ Terminations (${activeTerminations.length})`,
            value: activeTerminations.length > 0
              ? activeTerminations.map((t, i) => `**#${i + 1}** — ${t.reason} — *${t.date.slice(0, 10)}*`).join('\n')
              : 'None'
          },
          {
            name: `⛔ Blacklists (${activeBlacklists.length})`,
            value: activeBlacklists.length > 0
              ? activeBlacklists.map((b, i) => `**#${i + 1}** — ${b.reason} — *${b.date.slice(0, 10)}*`).join('\n')
              : 'None'
          },
          {
            name: `📝 Notes (${notes.length})`,
            value: notes.length > 0
              ? notes.map((n, i) => `**#${i + 1}** — ${n.note} — *${n.addedBy?.username || 'Unknown'}*`).join('\n')
              : 'None'
          }
        )
        .setFooter({ text: 'Human Resources Department' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Error in /staffinfo command:', err);
      try { await interaction.editReply({ content: '❌ Error running command.' }); } catch {}
    }
  }
};