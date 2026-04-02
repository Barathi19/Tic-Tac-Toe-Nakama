import resolve from '@rollup/plugin-node-resolve';
import commonJS from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default {
	input: './src/index.ts',
	context: 'this',
	output: {
		file: 'build/index.js',
		format: 'cjs'
	},
	plugins: [
		resolve(),
		commonJS(),
		typescript()
	]
};
