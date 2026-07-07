// Widget bundle build (CommonJS — this project's package.json is not ESM).
//
// The Faclon Deployer runs `npm run build:bundle`, which produces standalone
// self-registering widget bundles under `dist-bundle/`:
//   - HistogramWidget.bundle.js              → window.ReactWidgets['HistogramWidget']
//   - HistogramWidgetConfiguration.bundle.js → window.ReactWidgets['HistogramWidgetConfiguration']
// The IO Lens host loads these via <script> and calls mount()/update()/unmount().
// React (+ ReactDOM) are provided by the host, so they are externalized here.
//
// The Next.js app (`next build` / `next dev`) is only the local dev harness; the
// deployment artifact is these webpack bundles.

const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const COMPONENTS = {
  HistogramWidget: './src/components/HistogramWidget/index.ts',
  HistogramWidgetConfiguration: './src/components/HistogramWidgetConfiguration/index.ts',
};

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    mode: isProd ? 'production' : 'development',
    entry: COMPONENTS,
    output: {
      path: path.resolve(__dirname, 'dist-bundle'),
      filename: '[name].bundle.js',
      globalObject: 'this',
      clean: true,
    },
    // React/ReactDOM come from the host runtime (window.React / window.ReactDOM).
    externals: {
      react: 'React',
      'react-dom': 'ReactDOM',
      'react-dom/client': 'ReactDOM',
      'react-dom/server': 'ReactDOMServer',
      'react/jsx-runtime': 'ReactJSXRuntime',
      'react/jsx-dev-runtime': 'ReactJSXRuntime',
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
        // design-sdk's ESM dist omits `.js` extensions on internal imports;
        // webpack 5 enforces fully-specified ESM imports by default. Relax it.
        {
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
        {
          test: /\.(png|jpg|jpeg|gif|webp|svg|woff2?)$/i,
          type: 'asset/resource',
          generator: { filename: 'assets/[name][ext]' },
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: '[name].bundle.css' }),
      // Inline the client-only `import('highcharts/modules/exporting')` dynamic
      // import into the main bundle so each widget ships as a single .js file.
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    ],
    performance: { hints: false },
  };
};
