const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { StaffRecord } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewdiscipline')
    .setDescription('View the discipline record of a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view discipline for')
        .setRequired(true)
    ),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const targetUser = interaction.options.getUser('user');
    const record = await StaffRecord.findById(targetUser.id);

    if (!record) {
      return interaction.editReply({ content: '❌ No discipline record found for this user.' });
    }

    const buildFields = (array, type) => {
      return array.map((entry, index) => {
        const status = entry.removed ? '✅ Past' : '⚠️ Active';
        const addedBy = entry.addedBy?.username || 'Unknown';
        return {
          name: `${type} #${index + 1} ${status}`,
          value: `**Reason:** ${entry.reason}\n**Date:** ${entry.date}\n**Added By:** ${addedBy}${entry.removed ? `\n**Removed**` : ''}`
        };
      });
    };

    const allEntries = [
      ...buildFields(record.strikes || [], 'Strike'),
      ...buildFields(record.terminations || [], 'Termination'),
      ...buildFields(record.blacklists || [], 'Blacklist')
    ];

    if (allEntries.length === 0) {
      return interaction.editReply({ content: '❌ No discipline record found for this user.' });
    }

    const pageSize = 10;
    const pages = [];

    for (let i = 0; i < allEntries.length; i += pageSize) {
      const embed = new EmbedBuilder()
        .setTitle(`Discipline Record for ${targetUser.tag}`)
        .setColor('#ff0000')
        .setTimestamp()
        .addFields(allEntries.slice(i, i + pageSize));
      pages.push(embed);
    }

    let currentPage = 0;

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(pages.length <= 1)
      );

    const message = await interaction.editReply({ embeds: [pages[currentPage]], components: [row], fetchReply: true });

    if (pages.length <= 1) return;

    const collector = message.createMessageComponentCollector({ time: 600000 });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Only the command user can navigate pages.', ephemeral: true });
      if (i.customId === 'next') currentPage++;
      else if (i.customId === 'prev') currentPage--;

      const newRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === pages.length - 1)
        );

      await i.update({ embeds: [pages[currentPage]], components: [newRow] });
    });

    collector.on('end', async () => {
      const disabledRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(true)
        );
      message.edit({ components: [disabledRow] }).catch(() => {});
    });
  }
};
