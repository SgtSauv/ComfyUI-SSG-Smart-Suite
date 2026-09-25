import os
import re
import importlib.metadata
from aiohttp import web
import server
from .ssg_smart_suite import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# 👽 ALIENWARE BLUE TRUECOLOR CONSTANTS
AW_BLUE = "\033[38;2;0;225;255m"
AW_RESET = "\033[0m"
AW_BOLD = "\033[1m"

current_dir = os.path.dirname(os.path.abspath(__file__))

def read_file_safely(path):
    if os.path.exists(path) and os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception as e:
            print(f"{AW_BLUE}[SSG Suite Warning]{AW_RESET} Could not read {path}: {e}")
    return None

def get_package_version():
    """
    Parses pyproject.toml as the Single Source of Truth (SSOT) for package versioning.
    Employs built-in tomllib (Python 3.11+) with regex fallback for Python 3.10 environments.
    """
    pyproject_path = os.path.join(current_dir, "pyproject.toml")
    if not os.path.exists(pyproject_path):
        return "4.0"

    try:
        try:
            import tomllib
            with open(pyproject_path, "rb") as f:
                data = tomllib.load(f)
                return data.get("project", {}).get("version", "4.0")
        except ImportError:
            try:
                import tomli as tomllib
                with open(pyproject_path, "rb") as f:
                    data = tomllib.load(f)
                    return data.get("project", {}).get("version", "4.0")
            except ImportError:
                content = read_file_safely(pyproject_path)
                if content:
                    match = re.search(r'version\s*=\s*["\']([^"\']+)["\']', content)
                    if match:
                        return match.group(1)
    except Exception as e:
        print(f"{AW_BLUE}[SSG Suite Warning]{AW_RESET} Could not resolve version from pyproject.toml: {e}")

    return "4.0"

def get_comfy_frontend_version():
    """
    Sniffs the installed ComfyUI Frontend semver from package distributions.
    Checks comfyui-frontend-package, comfyui-frontend, and comfyui metadata.
    """
    candidate_packages = [
        "comfyui-frontend-package",
        "comfyui-frontend",
        "comfyui_frontend",
        "comfyui"
    ]
    for pkg in candidate_packages:
        try:
            ver = importlib.metadata.version(pkg)
            if ver:
                return ver.strip().lstrip("v")
        except Exception:
            continue
    return "0.0.0"

pkg_frontend_version = get_comfy_frontend_version()

# ==========================================================================
# BACKEND API ROUTE PROVISIONING (/ssg/suite/docs & /ssg/suite/frontend_version)
# ==========================================================================
try:
    routes = server.PromptServer.instance.app.router

    async def handle_get_suite_docs(request):
        readme_path = os.path.join(current_dir, "README.md")
        manual_path = os.path.join(current_dir, "web", "docs", "manual.md")
        hud_guide_path = os.path.join(current_dir, "web", "docs", "smart_hud.md")

        return web.json_response({
            "version": get_package_version(),
            "frontend_version": pkg_frontend_version,
            "readme": read_file_safely(readme_path),
            "manual": read_file_safely(manual_path),
            "hud_guide": read_file_safely(hud_guide_path)
        })

    async def handle_get_frontend_version(request):
        return web.json_response({
            "frontend_version": pkg_frontend_version
        })

    routes.add_get("/ssg/suite/docs", handle_get_suite_docs)
    routes.add_get("/ssg/suite/frontend_version", handle_get_frontend_version)
except Exception as e:
    print(f"{AW_BLUE}[SSG Suite Warning]{AW_RESET} Could not register SSG API routes: {e}")

# Dynamic Core Count
core_count = len(NODE_CLASS_MAPPINGS)
pkg_version = get_package_version()

# Minimalist Truecolor Terminal Boot Sequence Banner
print(f"{AW_BLUE}=========================================================================={AW_RESET}")
print(f"{AW_BLUE}{AW_BOLD}SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE){AW_RESET}")
print(f"{AW_BLUE}Status: {core_count}-Core Smart Suite Engine v{pkg_version} + Smart HUD ➔ {AW_BOLD}LOADED SUCCESSFULLY{AW_RESET}")
print(f"{AW_BLUE}\"We build tools that tune the engine. We don't just repaint the chassis.\"{AW_RESET}")
print(f"{AW_BLUE}=========================================================================={AW_RESET}")

# Tells ComfyUI to serve the JavaScript folder to the browser
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]