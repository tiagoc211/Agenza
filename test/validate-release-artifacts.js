const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');

const EXPECTED_RELEASE_VERSION = '0.3.0';
const projectRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.join(projectRoot, 'out', 'make', 'squirrel.windows', 'x64');
const packagedDirectory = path.join(projectRoot, 'out', 'Agenza-win32-x64');
const setupName = `${packageJson.productName}-${packageJson.version} Setup.exe`;
const packageName = `${packageJson.name}-${packageJson.version}-full.nupkg`;
const packagedExecutablePath = path.join(packagedDirectory, `${packageJson.productName}.exe`);

const artifacts = [
  {
    minimumSize: 1_000_000,
    name: 'Windows installer',
    path: path.join(releaseDirectory, setupName),
  },
  {
    minimumSize: 1_000_000,
    name: 'Squirrel package',
    path: path.join(releaseDirectory, packageName),
  },
  {
    minimumSize: 1,
    name: 'Squirrel release manifest',
    path: path.join(releaseDirectory, 'RELEASES'),
  },
  {
    minimumSize: 1_000_000,
    name: 'Packaged executable',
    path: packagedExecutablePath,
  },
  {
    minimumSize: 1,
    name: 'Packaged application archive',
    path: path.join(packagedDirectory, 'resources', 'app.asar'),
  },
  {
    minimumSize: 1,
    name: 'Windows ConPTY native runtime',
    path: path.join(
      packagedDirectory,
      'resources',
      'app.asar.unpacked',
      '.webpack',
      'main',
      'node_modules',
      'node-pty',
      'prebuilds',
      'win32-x64',
      'conpty.node',
    ),
  },
];

const failures = [];

if (packageJson.version !== EXPECTED_RELEASE_VERSION) {
  failures.push(
    `Release metadata must use ${EXPECTED_RELEASE_VERSION}, found ${packageJson.version}.`,
  );
}

if (fs.existsSync(packagedExecutablePath)) {
  try {
    const versionInfo = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            '$info = (Get-Item -LiteralPath $env:AGENZA_RELEASE_EXECUTABLE).VersionInfo;',
            '[PSCustomObject]@{ productName = $info.ProductName; productVersion = $info.ProductVersion }',
            '| ConvertTo-Json -Compress',
          ].join(' '),
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, AGENZA_RELEASE_EXECUTABLE: packagedExecutablePath },
          windowsHide: true,
        },
      ).trim(),
    );

    if (versionInfo.productName !== packageJson.productName) {
      failures.push(
        `Packaged executable product name must be ${packageJson.productName}, found ${versionInfo.productName}.`,
      );
    }

    if (versionInfo.productVersion !== EXPECTED_RELEASE_VERSION) {
      failures.push(
        `Packaged executable version must be ${EXPECTED_RELEASE_VERSION}, found ${versionInfo.productVersion}.`,
      );
    }
  } catch (error) {
    failures.push(`Unable to inspect packaged executable metadata: ${error.message}`);
  }
}

for (const artifact of artifacts) {
  try {
    const stats = fs.statSync(artifact.path);

    if (!stats.isFile() || stats.size < artifact.minimumSize) {
      failures.push(`${artifact.name} is incomplete: ${artifact.path}`);
    }
  } catch {
    failures.push(`${artifact.name} is missing: ${artifact.path}`);
  }
}

const releaseManifestPath = path.join(releaseDirectory, 'RELEASES');

if (fs.existsSync(releaseManifestPath)) {
  const releaseManifest = fs.readFileSync(releaseManifestPath, 'utf8');

  if (!releaseManifest.includes(packageName)) {
    failures.push(`Squirrel release manifest does not reference ${packageName}.`);
  }
}

if (failures.length > 0) {
  console.error('Agenza release artifact validation failed:');

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exit(1);
}

console.log(`Agenza ${packageJson.version} release artifacts are complete.`);
console.log(`Installer: ${path.join(releaseDirectory, setupName)}`);
