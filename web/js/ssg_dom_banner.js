// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: Native DOM Status Banner Engine & Factory
// File: /web/js/ssg_dom_banner.js
// ==========================================================================

import {
    SSG_COLOR_AWBLUE,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_FIRE_OPAL,
    SSG_COLOR_RUBY_RED,
    SSG_COLOR_MUTED
} from "./ssg_core_utils.js";

export const SSG_COLOR_NOMINAL = null;
const DEFAULT_BANNER_HEIGHT = 26;

/**
 * Ensures global CSS rules for SSG DOM banners are injected into the document head once.
 * Incorporates clamped font scaling and rigid box containment to prevent zoom clipping.
 */
function ensureGlobalBannerStyles() {
    const styleId = "ssg-dom-banner-styles";
    if (document.getElementById(styleId)) return;

    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
        .ssg-dom-banner-container {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            height: ${DEFAULT_BANNER_HEIGHT}px !important;
            min-height: ${DEFAULT_BANNER_HEIGHT}px !important;
            max-height: ${DEFAULT_BANNER_HEIGHT}px !important;
            line-height: ${DEFAULT_BANNER_HEIGHT - 2}px !important;
            box-sizing: border-box !important;
            padding: 0 8px !important;
            margin: 0 !important;
            background-color: #0f1216 !important;
            border: 1px solid #333b46;
            border-radius: 4px !important;
            font-family: 'Courier New', Courier, monospace !important;
            font-size: clamp(9px, 0.72rem, 11px) !important;
            font-weight: 700 !important;
            letter-spacing: 0.5px !important;
            user-select: none !important;
            pointer-events: none !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            transition: border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease !important;
        }

        .ssg-dom-banner-label {
            display: inline-block !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            line-height: inherit !important;
            max-width: 100% !important;
        }

        .ssg-dom-banner-badge {
            display: inline-block !important;
            margin-left: 6px !important;
            padding: 1px 4px !important;
            border-radius: 2px !important;
            font-size: clamp(8px, 0.6rem, 9px) !important;
            letter-spacing: 0.3px !important;
            line-height: normal !important;
            flex-shrink: 0 !important;
        }
    `;
    document.head.appendChild(styleEl);
}

/**
 * Resolves stroke and fill colors with Tier 0 Nominal falling back strictly
 * to native ComfyUI palette tokens.
 */
function resolveNativePalette(colorHex) {
    const defaultStroke = (typeof LiteGraph !== "undefined" && LiteGraph.WIDGET_OUTLINE_COLOR)
        ? LiteGraph.WIDGET_OUTLINE_COLOR
        : "#333b46";
    const defaultText = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TEXT_COLOR)
        ? LiteGraph.NODE_TEXT_COLOR
        : "#cccccc";

    return {
        stroke: colorHex || defaultStroke,
        text: colorHex || defaultText
    };
}

/**
 * Creates and attaches a native DOM Status Banner widget at Slot 0 of the target node.
 * Bypasses Canvas 2D render loops for status rendering.
 */
export function createSSGDOMBanner(node, options = {}) {
    ensureGlobalBannerStyles();

    const widgetName = options.widgetName || "channel_display";
    const initialText = options.initialText || "◦";
    const initialColor = options.initialColor !== undefined ? options.initialColor : SSG_COLOR_NOMINAL;
    const initialBadge = options.initialBadge || null;
    const badgeColor = options.badgeColor || null;

    // Idempotency: Clean up existing DOM banner widget if re-configuring
    if (node._ssgDOMBanner) {
        if (node._ssgDOMBanner.element && node._ssgDOMBanner.element.parentNode) {
            node._ssgDOMBanner.element.parentNode.removeChild(node._ssgDOMBanner.element);
        }
        if (Array.isArray(node.widgets)) {
            node.widgets = node.widgets.filter(w => w !== node._ssgDOMBanner);
        }
        node._ssgDOMBanner = null;
    }

    // Root DOM Container
    const container = document.createElement("div");
    container.className = "ssg-dom-banner-container";
    
    // Explicit inline locks to override host layout injections
    container.style.setProperty("box-sizing", "border-box", "important");
    container.style.setProperty("overflow", "hidden", "important");
    container.style.setProperty("height", `${DEFAULT_BANNER_HEIGHT}px`, "important");
    container.style.setProperty("min-height", `${DEFAULT_BANNER_HEIGHT}px`, "important");
    container.style.setProperty("max-height", `${DEFAULT_BANNER_HEIGHT}px`, "important");

    // Text Label Element
    const labelSpan = document.createElement("span");
    labelSpan.className = "ssg-dom-banner-label";
    labelSpan.textContent = initialText;
    container.appendChild(labelSpan);

    // Optional Sub-Badge Element (Router Bank A/B, Loop TX/RX, etc.)
    const badgeSpan = document.createElement("span");
    badgeSpan.className = "ssg-dom-banner-badge";
    badgeSpan.style.display = initialBadge ? "inline-block" : "none";
    if (initialBadge) {
        badgeSpan.textContent = initialBadge;
    }
    container.appendChild(badgeSpan);

    // Apply initial tone & styling (Defaults strictly to Native Comfy Tier 0)
    applyBannerStyle(container, labelSpan, badgeSpan, initialColor, badgeColor);

    // Mount native DOM widget via ComfyUI V2 / LiteGraph DOM hook
    const domWidget = node.addDOMWidget(widgetName, "custom", container, {
        serialize: false,
        hideOnZoom: false,
        getValue() {
            return labelSpan.textContent;
        },
        setValue(v) {
            labelSpan.textContent = v;
        }
    });

    // Enforce fixed vertical height reservation in node widget stack
    domWidget.computeSize = function (width) {
        return [width || 0, DEFAULT_BANNER_HEIGHT + 6];
    };

    // Store references on node
    node._ssgDOMBanner = domWidget;
    node._ssgDOMBannerEl = container;
    node._ssgDOMBannerLabel = labelSpan;
    node._ssgDOMBannerBadge = badgeSpan;

    /**
     * Direct synchronous mutation hook bound to the node instance.
     * Passing null or omitting colorHex defaults strictly to Tier 0 Native Comfy.
     */
    node.updateSSGBanner = function (text, colorHex = SSG_COLOR_NOMINAL, subBadge = null, subBadgeColor = null) {
        if (!node._ssgDOMBannerLabel || !node._ssgDOMBannerEl) return;

        if (text !== undefined && text !== null) {
            node._ssgDOMBannerLabel.textContent = text;
        }

        if (subBadge !== undefined) {
            if (subBadge && subBadge.length > 0) {
                node._ssgDOMBannerBadge.textContent = subBadge;
                node._ssgDOMBannerBadge.style.display = "inline-block";
            } else {
                node._ssgDOMBannerBadge.textContent = "";
                node._ssgDOMBannerBadge.style.display = "none";
            }
        }

        applyBannerStyle(
            node._ssgDOMBannerEl,
            node._ssgDOMBannerLabel,
            node._ssgDOMBannerBadge,
            colorHex,
            subBadgeColor
        );
    };

    // Slot 0 Enforcement: Re-order widget stack to guarantee Banner sits at top
    if (Array.isArray(node.widgets) && node.widgets.length > 1) {
        const otherWidgets = node.widgets.filter(w => w !== domWidget);
        node.widgets = [domWidget, ...otherWidgets];
    }

    return domWidget;
}

/**
 * Applies diagnostic neon tokens or native ComfyUI muted styles to DOM elements.
 * When colorHex is null (Tier 0 Nominal), removes box-shadow glows completely.
 */
function applyBannerStyle(containerEl, labelEl, badgeEl, colorHex, badgeColorHex = null) {
    if (!containerEl || !labelEl) return;

    const palette = resolveNativePalette(colorHex);

    containerEl.style.borderColor = palette.stroke;
    labelEl.style.color = palette.text;

    // Glowing drop-shadow only for explicit diagnostic alert states; strictly none for Tier 0 Nominal
    if (colorHex === SSG_COLOR_AWBLUE) {
        containerEl.style.boxShadow = `0 0 6px rgba(0, 229, 255, 0.25)`;
    } else if (colorHex === SSG_COLOR_FIRE_OPAL) {
        containerEl.style.boxShadow = `0 0 6px rgba(255, 119, 0, 0.3)`;
    } else if (colorHex === SSG_COLOR_RUBY_RED) {
        containerEl.style.boxShadow = `0 0 6px rgba(255, 51, 51, 0.35)`;
    } else if (colorHex === SSG_COLOR_YELLOW_TOPAZ) {
        containerEl.style.boxShadow = `0 0 5px rgba(255, 204, 0, 0.2)`;
    } else {
        containerEl.style.boxShadow = "none";
    }

    if (badgeEl && badgeEl.style.display !== "none") {
        const badgePalette = resolveNativePalette(badgeColorHex || colorHex);
        badgeEl.style.color = badgePalette.text;
        badgeEl.style.border = `1px solid ${badgePalette.stroke}`;
        badgeEl.style.backgroundColor = "rgba(0, 0, 0, 0.3)";
    }
}