/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 / playwright 는 네이티브 모듈이라 번들링하면 안 됩니다.
  serverExternalPackages: ["better-sqlite3", "playwright"],
};
export default nextConfig;
