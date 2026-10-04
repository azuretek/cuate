# Popover caret at 14px (#217)

Close crops from one design-capture run at 14px: one per menu and panel surface, at desktop (1100x720) and 390px phone, in light and dark, with the default palette and the imported theme. Each crop is the panel plus a small margin, so the caret and the panel edge read at size.

Surfaces: the chats sort menu (3), the filter menu (4), the search-mode menu (5), the message-actions menu (8), the emoji panel (9), the attachment menu (10).

The caret is the panel border token at the panel's own 1px weight, filled with the panel surface token, and each of its bases sits exactly one border width inside the panel, so the panel edge rises into the triangle with no seam, no gap and no double line. Every surface opens through the shared popover and carries `data-popover`; none draws a caret of its own.
