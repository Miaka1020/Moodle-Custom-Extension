const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/content.js',

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'content.js'
  },

  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'public' }
      ]
    })
  ]
};