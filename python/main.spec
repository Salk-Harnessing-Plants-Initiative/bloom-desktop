# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import copy_metadata, collect_data_files

block_cipher = None

# Copy package metadata to fix importlib.metadata.version() calls
# nidaqmx uses importlib.metadata.version(__name__) in __init__.py
# which requires the .dist-info directory to be bundled
datas = []
datas += copy_metadata('nidaqmx')

# Optional: Include nidaqmx data files (like _installer_metadata.json)
# This is used by the nidaqmx.installdriver() CLI command
datas += collect_data_files('nidaqmx', include_py_files=False)

a = Analysis(
    ['main.py'],
    pathex=['./python'],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'numpy',
        'pypylon',
        'imageio',
        'nidaqmx',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='bloom-hardware',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
