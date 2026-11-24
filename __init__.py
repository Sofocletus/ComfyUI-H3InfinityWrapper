import sys

if sys.platform == "win32":
    from functools import wraps
    from asyncio.proactor_events import _ProactorBasePipeTransport

    def _silence_winerror_10054(func):
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            try:
                return func(self, *args, **kwargs)
            except ConnectionResetError as e:
                if getattr(e, "winerror", None) != 10054:
                    raise
        return wrapper

    if not getattr(_ProactorBasePipeTransport._call_connection_lost, "_h3_patched", False):
        patched = _silence_winerror_10054(_ProactorBasePipeTransport._call_connection_lost)
        patched._h3_patched = True
        _ProactorBasePipeTransport._call_connection_lost = patched

from .H3InfinityWrapper_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .H3InfinityWrapper_latentCombine import (
    NODE_CLASS_MAPPINGS as LATENT_COMBINE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as LATENT_COMBINE_DISPLAY_NAME_MAPPINGS,
)
from .H3InfinityWrapper_HybridStitcher import (
    NODE_CLASS_MAPPINGS as HYBRID_STITCHER_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as HYBRID_STITCHER_DISPLAY_NAME_MAPPINGS,
)
from .H3InfinityWrapper_ingest import (
    NODE_CLASS_MAPPINGS as INGEST_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as INGEST_DISPLAY_NAME_MAPPINGS,
)
from .H3InfinityWrapper_api_routes import setup_routes
import server

NODE_CLASS_MAPPINGS = {
    **NODE_CLASS_MAPPINGS,
    **LATENT_COMBINE_CLASS_MAPPINGS,
    **HYBRID_STITCHER_CLASS_MAPPINGS,
    **INGEST_CLASS_MAPPINGS,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    **NODE_DISPLAY_NAME_MAPPINGS,
    **LATENT_COMBINE_DISPLAY_NAME_MAPPINGS,
    **HYBRID_STITCHER_DISPLAY_NAME_MAPPINGS,
    **INGEST_DISPLAY_NAME_MAPPINGS,
}

# Initialize our custom API endpoints passing the ComfyUI server instance
setup_routes(server.PromptServer.instance)

# Tell ComfyUI to serve any static files in our /web/js/ directory to the browser
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]