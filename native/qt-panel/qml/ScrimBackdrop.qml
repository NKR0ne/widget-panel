import QtQuick
import QtQuick.Effects
import QtPanel.Native

// Acrylic material for a transient layer (modal, drawer, overlay), replacing
// the flat dim rectangles those layers used to draw.
//
// This follows the Fluent acrylic layer stack that Windows uses for the Start
// menu and the Widgets board, rebuilt in-scene because DWM can only apply a
// backdrop to a whole window, never to an element inside one. Unlike the
// window's own DWM backdrop this blurs the panel's *own* content, which is
// controlled and legible.
//
//   backdrop sample -> gaussian blur -> saturation boost -> luminosity layer
//   -> tint -> grain
//
// The luminosity layer is the load-bearing one and the reason the stack has to
// be built in this order: the panel is translucent, so its blurred copy is
// translucent too, and laid straight over the original it veils nothing —
// sharp text reads right through it. Luminosity is what guarantees contrast
// regardless of what sits behind, and it is the layer a naive
// "blur it and composite it back" approach silently omits.
//
// Exclusion blend is the one documented step not reproduced here; it mostly
// suppresses muddy mid-greys and needs a custom blend mode to do properly.
//
// The capture is taken once when the layer opens (ShaderEffectSource.live is
// false) because the content behind a modal does not move. An always-on panel
// therefore pays a single frame instead of re-blurring every frame the layer
// stays up.
//
// Corner radius is deliberately not handled here: DWMWCP_ROUND clips the whole
// window at the compositor, so square content corners never reach the screen.
Item {
    id: scrim

    // Item to blur — normally the panel chrome the overlay floats above.
    property Item source: null
    // Drives the capture; bind to the owning layer's open state.
    property bool active: false
    // Overall weight of the material. Blurred backdrops need far less darkening
    // than flat ones, so this is scaled down heavily when the blur is live.
    property real dim: 0.5
    property real blurAmount: 1.0
    // Material identity. Follows Windows when asked to, otherwise uses the
    // panel's own colour rather than Fluent's neutral grey so the layer reads
    // as part of this app.
    property color tint: Theme.surfaceTint

    readonly property bool blurActive: Ui.surfaceLighting && Theme.materialEnabled
                                       && source !== null

    onActiveChanged: if (active) snapshot.scheduleUpdate()
    onWidthChanged: if (active) snapshot.scheduleUpdate()
    onHeightChanged: if (active) snapshot.scheduleUpdate()

    ShaderEffectSource {
        id: snapshot
        anchors.fill: parent
        sourceItem: scrim.blurActive ? scrim.source : null
        live: false
        hideSource: false
        visible: false
        // Half resolution: cheaper to capture, and the downsample does part of
        // the blur for free.
        textureSize: Qt.size(Math.max(1, Math.round(scrim.width / 2)),
                             Math.max(1, Math.round(scrim.height / 2)))
    }

    // Luminosity layer.
    Rectangle {
        anchors.fill: parent
        visible: scrim.blurActive
        // Not quite opaque: a sliver of the real panel underneath keeps the
        // window's own material from disappearing entirely behind a sheet.
        color: Qt.rgba(scrim.tint.r, scrim.tint.g, scrim.tint.b, 0.86)
    }

    // Blurred, saturation-boosted backdrop sample.
    MultiEffect {
        anchors.fill: parent
        visible: scrim.blurActive
        source: snapshot
        autoPaddingEnabled: false
        blurEnabled: true
        blur: scrim.blurAmount
        // blurMax alone tops out well short of frosted glass; blurMultiplier is
        // what pushes the sampling distance far enough that body text stops
        // being readable, which is the point — the layer behind must read as
        // material, not as content competing for attention. Tuned so the large
        // colour pools still show through and the layer stays legible as place.
        blurMax: 64
        blurMultiplier: 0.8
        // Blur washes colour out; Fluent compensates by pushing saturation back
        // up rather than letting the material go grey.
        saturation: 0.32
    }

    // Tint wash.
    Rectangle {
        anchors.fill: parent
        visible: scrim.blurActive
        color: Qt.rgba(scrim.tint.r, scrim.tint.g, scrim.tint.b, scrim.dim * 0.35)
    }

    // Grain. Breaks up banding across the blur gradient and is most of what
    // makes the material read as a physical surface rather than a gradient.
    Image {
        anchors.fill: parent
        visible: scrim.blurActive
        source: "textures/acrylic-noise.png"
        fillMode: Image.Tile
        opacity: 0.035
    }

    // Fallback when surface lighting is off: the plain dim this replaced.
    Rectangle {
        anchors.fill: parent
        visible: !scrim.blurActive
        color: Qt.rgba(0.02, 0.03, 0.05, scrim.dim)
    }
}
