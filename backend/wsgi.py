"""
WSGI entry point for PythonAnywhere.

PythonAnywhere runs WSGI; FastAPI is ASGI.  a2wsgi bridges the two so the
app works without any changes to main.py.

In the PythonAnywhere WSGI configuration file, replace its entire contents
with:

    import sys
    path = '/home/YOUR_USERNAME/claude_office/backend'
    if path not in sys.path:
        sys.path.insert(0, path)
    from wsgi import application
"""
import os
import sys

# Ensure imports resolve from this directory
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# Make relative paths (office.db, uploads/) resolve inside the backend dir
os.chdir(HERE)

from main import app  # noqa: E402
from a2wsgi import ASGIMiddleware  # noqa: E402

application = ASGIMiddleware(app)
