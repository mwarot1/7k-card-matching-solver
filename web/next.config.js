/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    images: {
        unoptimized: true,
    },
    // If your GitHub Pages URL is https://<username>.github.io/<project-name>/
    // then you must add the project name as the basePath.
    // Example: basePath: '/7k-card-matching-solver',
    trailingSlash: true,
};

module.exports = nextConfig;
