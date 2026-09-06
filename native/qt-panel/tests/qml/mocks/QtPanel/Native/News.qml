pragma Singleton
import QtQuick
QtObject {
    property var categories: ["Quebec", "Science"]
    signal categoryUpdated(string label)
    function itemsFor(label) {
        const items = []
        for (let i = 0; i < 20; ++i)
            items.push({ title: label + " - Article " + (i + 1),
                link: "https://example.test/" + label + "/" + i,
                description: "Un resume de cette nouvelle pour parcourir les articles de la categorie.",
                source: "Journal de test", time: "09:30", image: "" })
        return items
    }
    function isLoading(label) { return false }
    function refresh() { categoryUpdated("Quebec") }
    function importOpml(file) {}
    function moveCategory(from, to) {}
}
