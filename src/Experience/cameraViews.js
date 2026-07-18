/**
 * Camera viewpoints cycled by the ‹ › HUD buttons.
 *
 * Adding a view = appending one entry: {id, name, position, target}
 * (world coordinates; orbit controls stay active from every view, these are
 * just starting vantages). Placeholder positions for now.
 *
 * The 'seat' entry has no fixed coordinates — it resolves to the player's
 * own seat (see Camera.resolveViewTransform) and is skipped while not in
 * a room.
 */
export default [
    {id: 'balcony', name: 'Balcony', position: [0, 8, 15], target: [0, 1, 0]},
    {id: 'seat', name: 'My seat', seat: true},
    {id: 'stage-front', name: 'Stage front', position: [0, 1.8, -2], target: [0, 1.2, -8]},
    {id: 'side', name: 'Side stage', position: [8, 3, -5], target: [0, 1, -6]},
    {id: 'birds-eye', name: "Bird's eye", position: [0, 14, 2], target: [0, 0, -4]},
    {id: 'stadium', name: 'Stadium', position: [30, 20, 34], target: [0, 2, -7]},
]
