const shell = require('shelljs');
const {exec} = require('child_process');
const fs = require('fs');
// const {mercurialFunctions} = require('./node-scripts-helpers');

const environment = process.argv[2];

if (!environment) {
  console.log([
    'No se ha proporcionado un ambiente. Opciones válidas: prod | dev',
  ]);
  return;
}

const packageJsonPath = `${process.cwd()}/package.json`;
console.log("packageJsonPath->",packageJsonPath);
const packageJsonVersionObject = shell.grep('version', packageJsonPath).stdout.split(',')[0];

if (fs.existsSync(packageJsonPath)) {
  const packageJsonContent = fs.readFileSync(packageJsonPath);
  const packageJson = JSON.parse(packageJsonContent);
  const packageJsonVersion = packageJson.version;
  getBranchName(packageJsonVersion);
} else {
  console.log('El archivo no existe en la ruta especificada.');
}

function getBranchName(packageJsonVersion) {
  exec('git rev-parse --abbrev-ref HEAD', function (error, stdout, stderr) {
    if (error) {
      console.error(`[Error-Branch] ${error}`);
      return;
    }
    const branchName = stdout.trim();
    console.log('branchName->', branchName)
    getLastTag(branchName, packageJsonVersion);
  });
}

function getLastTag(branchName, packageJsonVersion) {
  exec(`git describe --tags --abbrev=0`, function (error, stdout, stderr) {
    if (error) {
      console.error(`[Error-GetLastTag] ${error}`);
      return;
    }
    const lastTag = stdout.trim();
    console.log(`Last tag found: ${lastTag}`);
    loadVersion(lastTag, branchName, packageJsonVersion);
  });
}

function loadVersion(lastTag, branchName, packageJsonVersion) {
  console.log('packageJsonVersion->', packageJsonVersion)
  try {
    exec(`git log --oneline ${lastTag}..HEAD`, function (error, stdout, stderr) {
      if (error) {
        console.error('[Error-GetCommits]', error);
        return;
      }
      let commits = stdout.split('\n').filter(commit => !!commit);
      commits = commits.map(it => {
        return it.toString().split(" ")[1]
      })
      console.log('Commits:', commits);

      if (commits.length === 0) {
        console.error('No se encontraron cambios');
        return;
      }

      let majorVersion = parseInt(packageJsonVersion.split('.')[0]);
      let minorVersion = parseInt(packageJsonVersion.split('.')[1]);
      let patchVersion = parseInt(packageJsonVersion.split('.')[2]);

      commits.forEach(commit => {
        if (isMajor(commit)) {
          majorVersion += 1;
          minorVersion = 0;
          patchVersion = 0;
        }
        if (isMinor(commit)) {
          minorVersion += 1;
          patchVersion = 0;
        }
        if (isPatch(commit)) {
          patchVersion += 1;
        }
      });

      const newVersion = `${majorVersion}.${minorVersion}.${patchVersion}`;
      console.log('Nueva versión:', newVersion);

      const packageVersion = `"version": "${newVersion}"`;
      console.log("packageJsonPath->", packageJsonPath)
      shell.sed('-i', packageJsonVersionObject, '  ' + packageVersion.trim(), packageJsonPath);

      if (packageJsonVersion === newVersion) {
        console.log('No se encontraron cambios en la versión ' + newVersion);
        return;
      }

      commitAll(packageJsonVersion, newVersion);
    });
  } catch (error) {
    // revertVersion(packageJsonVersion);
    console.log('error->', error);
  }

  function commitAll(oldVersion, newVersion) {
    const commitMessage = `chore: v${newVersion} on ${environment} environment`;
    console.log('Agregando archivos nuevos...');
    try {
      exec(`git add .`, function (error, stdout, stderr) {
        if (error) {
          console.error('Error al agregar archivos:', error);
          revertVersion(oldVersion);
          return;
        }
        console.log('Archivos agregados:', stdout);
        console.log('Removiendo archivos eliminados...');
        exec(`git add --all`, function (error, stdout, stderr) {
          if (error) {
            console.error('Error al remover archivos:', error);
            revertVersion(oldVersion);
            return;
          }
          console.log('Archivos removidos:', stdout);
          console.log('Generando commit...');
          exec(`git commit -m "${commitMessage}"`, function (error, stdout, stderr) {
            if (error) {
              console.error('Error al generar el commit:', error);
              revertVersion(oldVersion);
              return;
            }
            console.log('Commit generado:', stdout);
            pushCommits(oldVersion, newVersion);
          });
        });
      });
    } catch (error) {
      revertVersion(oldVersion);
      console.error('Error al realizar el commit y push:', error);
    }
  }

  function revertVersion(oldVersion) {
    console.log(`[Rollback] V.${oldVersion}`);
    const packageJsonPath = `${process.cwd()}/package.json`;
    const packageJsonContent = fs.readFileSync(packageJsonPath);
    const packageJson = JSON.parse(packageJsonContent);
    const packageVersion = `"version": "${oldVersion}"`;
    packageJson.version = oldVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  function pushCommits(oldVersion, newVersion) {
    const commitAndPush = 'git push --set-upstream origin main';
    console.log('Enviando commits al repositorio remoto...');
    try {
      exec(commitAndPush, function (error, stdout, stderr) {
        if (error) {
          console.error('[Failure-Push-commits]', error);
          revertVersion(oldVersion);
          return;
        }
        console.log('Se han guardado los cambios en el repositorio y actualizado en el servidor remoto');
        createTag(oldVersion, newVersion);
      });
    } catch (error) {
      revertVersion(oldVersion);
      console.error('[Error-Push-commits]', error);
    }
  }

  function createTag(oldVersion, newVersion) {
    console.log('newVersion->', newVersion);
    try {
      const nameTag = `v${newVersion}-${environment}`;
      exec(`git tag -a ${nameTag} -m "Version ${newVersion}"`, function (error, stdout, stderr) {
        if (error) {
          console.error('[Failure-Tag]', error);
          revertVersion(oldVersion);
          return;
        }
        console.log('Tag creado:', nameTag);
        pushTag(oldVersion, newVersion);
      });
    } catch (error) {
      console.error('[Error-Tag]', error);
    }
  }

  function pushTag(oldVersion, newVersion) {
    const comandPush = 'git push --tags';
    console.log('Enviando etiqueta al repositorio remoto...');
    try {
      exec(`${comandPush}`, function (error, stdout, stderr) {
        if (error) {
          console.error('[Failure-Push-tag]', error);
          revertVersion(oldVersion);
          return;
        }
        console.log('Etiqueta enviada al repositorio remoto');
        buildProject(oldVersion, newVersion);
      });
    } catch (error) {
      revertVersion(oldVersion);
      console.error('[Error-Push-tag]', error);
    }
  }

  function buildProject(oldVersion, newVersion) {
    try {
      exec(`npm run build-${environment}`, function (failure, code) {
        if (failure) {
          console.log('[Failure-Build-Project]', failure);
          revertVersion(oldVersion);
          return;
        }
        successMessage(newVersion);
      });
    } catch (error) {
      console.log(`[Error-Build-Project]${error}`);
    }
  }




}

function getSummary(code) {
  return (code.toString().split('summary:')[1] || '').trim();
}

function isMajor(code) {
  let exist = false;
  MAJOR.forEach((it) => {
    if (code.startsWith(it)) {
      exist = true;
      return;
    }
  });
  return exist;
}

function isMinor(code) {
  let exist = false;
  MINOR.forEach((it) => {
    if (code.startsWith(it)) {
      exist = true;
      return;
    }
  });
  return exist;
}

function isPatch(code) {
  let exist = false;
  PATCH.forEach((it) => {
    if (code.startsWith(it)) {
      exist = true;
      return;
    }
  });
  return exist;
}

function successMessage(newVersion) {
  console.log(
    '╔═════════════════.★.═════════════════════╗ \t\n' +
    `           SUCCESS ${newVersion}\t
` +
    '╚═════════════════.★.═════════════════════╝\t\n ',
  );
}

const MAJOR = ['feat!', 'fix!', 'build!'];
const MINOR = ['feat', 'build!', 'perf', 'test'];
const PATCH = ['fix', 'docs', 'style', 'refactor'];

