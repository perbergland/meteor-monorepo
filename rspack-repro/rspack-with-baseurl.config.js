const path = require('path');

// This config demonstrates the bug: jsc.baseUrl breaks resolve.symlinks: false
module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    symlinks: false,  // Should preserve symlink paths
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            baseUrl: __dirname,  // THIS BREAKS SYMLINK RESOLUTION!
            parser: {
              syntax: 'typescript',
            },
          },
        },
      },
    ],
  },
  mode: 'development',
  target: 'node',
};
