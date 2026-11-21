from .H3InfinityWrapper_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .H3InfinityWrapper_latentCombine import (
    NODE_CLASS_MAPPINGS as LATENT_COMBINE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as LATENT_COMBINE_DISPLAY_NAME_MAPPINGS,
)
from .H3InfinityWrapper_api_routes import setup_routes
import server

NODE_CLASS_MAPPINGS = {**NODE_CLASS_MAPPINGS, **LATENT_COMBINE_CLASS_MAPPINGS}
NODE_DISPLAY_NAME_MAPPINGS = {**NODE_DISPLAY_NAME_MAPPINGS, **LATENT_COMBINE_DISPLAY_NAME_MAPPINGS}

# Initialize our custom API endpoints passing the ComfyUI server instance
setup_routes(server.PromptServer.instance)

# Tell ComfyUI to serve any static files in our /web/js/ directory to the browser
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]