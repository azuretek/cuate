"""Resolve only explicitly supplied executable link inputs, never ambient rpaths."""
from pathlib import Path

def executable_dependency(dependency, node, native):
    for supplied in (node, native):
        if dependency == '@rpath/' + supplied.name or dependency == str(supplied):
            return supplied
    if dependency.startswith('@'):
        raise RuntimeError('unresolved executable dependency: ' + dependency)
    return Path(dependency)
