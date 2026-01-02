/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    images: {
        unoptimized: true,
    },
    // Ensure the basePath matches your repository name for GitHub Pages
    basePath: '/7k-card-matching-solver',
    assetPrefix: '/7k-card-matching-solver',
};

export default nextConfig;
