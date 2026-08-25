from .ssg_smart_suite import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# 👽 ALIENWARE BLUE TRUECOLOR CONSTANTS
AW_BLUE = "\033[38;2;0;225;255m"
AW_RESET = "\033[0m"
AW_BOLD = "\033[1m"

# Minimalist Truecolor Terminal Boot Sequence Banner
print(f"{AW_BLUE}=========================================================================={AW_RESET}")
print(f"{AW_BLUE}{AW_BOLD}SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE){AW_RESET}")
print(f"{AW_BLUE}Designation: SgtSauv & Gemini (Joint Architecture){AW_RESET}")
print(f"{AW_BLUE}Status: 8-Core Smart Suite Engine ➔ {AW_BOLD}LOADED SUCCESSFULLY{AW_RESET}")
print(f"{AW_BLUE}\"We build tools that fix the engine; we do not repaint the chassis.\"{AW_RESET}")
print(f"{AW_BLUE}=========================================================================={AW_RESET}")

# Tells ComfyUI to serve the JavaScript folder to the browser
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
