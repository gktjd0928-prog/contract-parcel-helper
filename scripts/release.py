"""계약소포 도우미 업데이트 배포 스크립트

사용법 (프로젝트 폴더에서):
  python scripts/release.py --notes "변경 내용"            # 화면·로직만 바뀐 경우 (버튼으로 바로 업데이트)
  python scripts/release.py --apk --notes "변경 내용"      # 네이티브(플러그인·권한·아이콘)가 바뀐 경우 새 APK 포함
  python scripts/release.py --dry-run --notes "..."        # 올리지 않고 파일만 만들어 확인

하는 일
  1. www/version.js 버전을 올림 (기본: 마지막 자리 +1, --version 으로 지정 가능)
  2. www 폴더를 dist/bundle-<버전>.zip 으로 묶고 SHA-256 계산
  3. (--apk) android 버전코드를 올리고 서명된 release APK 빌드
  4. GitHub Release v<버전> 에 zip(과 APK) 업로드
  5. updates/version.json 을 고쳐 커밋하고 push  → 앱이 이 파일을 보고 업데이트
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(ROOT, 'scripts', 'release_config.json')
VERSION_JS = os.path.join(ROOT, 'www', 'version.js')
GRADLE = os.path.join(ROOT, 'android', 'app', 'build.gradle')
MANIFEST = os.path.join(ROOT, 'updates', 'version.json')
DIST = os.path.join(ROOT, 'dist')
GH = os.path.join(ROOT, 'tools', 'gh', 'bin', 'gh.exe' if os.name == 'nt' else 'gh')


def run(cmd, cwd=ROOT, check=True):
    print('>', ' '.join(cmd) if isinstance(cmd, list) else cmd, flush=True)
    return subprocess.run(cmd, cwd=cwd, check=check, shell=isinstance(cmd, str))


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def bump(v):
    parts = [int(x) for x in v.split('.')]
    parts[-1] += 1
    return '.'.join(map(str, parts))


def manifest_url(cfg):
    return f"https://raw.githubusercontent.com/{cfg['repo']}/{cfg['branch']}/updates/version.json"


def set_version_js(version, cfg):
    write(VERSION_JS,
          "// 릴리스 스크립트(scripts/release.py)가 자동으로 고칩니다. 직접 수정하지 마세요.\n"
          f"window.APP_VERSION = '{version}';\n"
          f"window.UPDATE_MANIFEST_URL = '{manifest_url(cfg)}';\n")


def gradle_build():
    m = re.search(r'versionCode\s+(\d+)', read(GRADLE))
    return int(m.group(1))


def set_gradle(build, version):
    g = read(GRADLE)
    g = re.sub(r'versionCode\s+\d+', f'versionCode {build}', g, count=1)
    g = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version}"', g, count=1)
    write(GRADLE, g)


def zip_www(version):
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f'bundle-{version}.zip')
    www = os.path.join(ROOT, 'www')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(www):
            for name in sorted(files):
                full = os.path.join(base, name)
                z.write(full, os.path.relpath(full, www).replace(os.sep, '/'))
    h = hashlib.sha256()
    with open(out, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return out, h.hexdigest()


def build_apk(version):
    android = os.path.join(ROOT, 'android')
    gradlew = os.path.join(android, 'gradlew.bat' if os.name == 'nt' else 'gradlew')
    run('npx cap sync android')
    run([gradlew, 'assembleRelease', '--no-daemon', '-q'], cwd=android)
    src = os.path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    os.makedirs(DIST, exist_ok=True)
    dst = os.path.join(DIST, f'contract-parcel-helper-{version}.apk')
    shutil.copyfile(src, dst)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', required=True, help='앱에 보여 줄 변경 내용')
    ap.add_argument('--version', help='새 버전 (예: 1.2.0). 없으면 마지막 자리 +1')
    ap.add_argument('--apk', action='store_true', help='새 APK도 빌드해 함께 배포')
    ap.add_argument('--dry-run', action='store_true', help='GitHub에 올리지 않음')
    ap.add_argument('--keep-version', action='store_true', help='버전을 올리지 않음 (첫 배포용)')
    a = ap.parse_args()

    cfg = json.loads(read(CFG_PATH))
    cur = re.search(r"APP_VERSION = '([^']+)'", read(VERSION_JS)).group(1)
    version = a.version or (cur if a.keep_version else bump(cur))
    prev = json.loads(read(MANIFEST)) if os.path.exists(MANIFEST) else {}
    print(f'버전 {cur} → {version}', flush=True)

    set_version_js(version, cfg)
    build = gradle_build()
    apk = None
    if a.apk:
        if not a.keep_version:
            build += 1
        set_gradle(build, version)
        apk = build_apk(version)
    else:
        run('npx cap copy android')   # 다음 APK 빌드를 위해 android 쪽도 맞춰 둠

    bundle, checksum = zip_www(version)
    tag = f'v{version}'
    base = f"https://github.com/{cfg['repo']}/releases/download/{tag}"
    manifest = {
        'version': version,
        'bundleUrl': f'{base}/{os.path.basename(bundle)}',
        'checksum': checksum,
        'nativeBuild': build if a.apk else prev.get('nativeBuild', build),
        'apkUrl': f'{base}/{os.path.basename(apk)}' if apk else prev.get('apkUrl', ''),
        'notes': a.notes,
        'publishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    }
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    write(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)

    if a.dry_run:
        print('dry-run: GitHub에 올리지 않았습니다.')
        return

    # 1) 파일 먼저 올리고  2) 그다음 version.json 을 push (앱이 없는 파일을 가리키지 않도록)
    assets = [bundle] + ([apk] if apk else [])
    run([GH, 'release', 'create', tag, *assets, '--repo', cfg['repo'],
         '--title', f'계약소포 도우미 {version}', '--notes', a.notes])
    run(['git', 'add', '-A'])
    run(['git', 'commit', '-m', f'Release {tag}\n\n{a.notes}'])
    run(['git', 'push', 'origin', cfg['branch']])
    print(f'\n배포 완료: {tag}. 앱의 [설정 → 업데이트 확인]에서 받을 수 있습니다 (GitHub 캐시로 최대 5분 걸릴 수 있음).')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f'실패: {e}')
