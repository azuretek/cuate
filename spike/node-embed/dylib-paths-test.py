"""Portable regression checks for shared-build and absolute link identities."""
from pathlib import Path
import unittest
from dylib_paths import executable_dependency

class Paths(unittest.TestCase):
    def test_pinned_rpath_node(self):
        node = Path('/scratch/prefix/lib/libnode.137.dylib')
        self.assertEqual(executable_dependency('@rpath/libnode.137.dylib', node, Path('/scratch/native.dylib')), node)
    def test_absolute_node(self):
        node = Path('/prefix/lib/libnode.147.dylib')
        self.assertEqual(executable_dependency(str(node), node, Path('/scratch/native.dylib')), node)
    def test_native_rpath(self):
        native = Path('/scratch/libEmbeddedNativeHost.dylib')
        self.assertEqual(executable_dependency('@rpath/' + native.name, Path('/prefix/libnode.dylib'), native), native)
    def test_unknown_rpath_refused(self):
        with self.assertRaises(RuntimeError):
            executable_dependency('@rpath/untrusted.dylib', Path('/prefix/libnode.dylib'), Path('/scratch/native.dylib'))
    def test_absolute_transitive(self):
        self.assertEqual(executable_dependency('/prefix/lib/libuv.1.dylib', Path('/prefix/libnode.dylib'), Path('/scratch/native.dylib')), Path('/prefix/lib/libuv.1.dylib'))

unittest.main()
