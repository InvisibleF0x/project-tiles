package dominikmech.projecttiles

import dominikmech.projecttiles.domain.CatalogData
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.Project
import dominikmech.projecttiles.domain.ProjectCatalog
import dominikmech.projecttiles.domain.ProjectInput
import dominikmech.projecttiles.domain.Unavailable
import dominikmech.projecttiles.domain.clampGraphemes
import dominikmech.projecttiles.services.GitInfoProvider
import dominikmech.projecttiles.services.LanguageDetector
import dominikmech.projecttiles.services.LanguageTable
import dominikmech.projecttiles.services.unavailability
import dominikmech.projecttiles.services.volumeRoot
import dominikmech.projecttiles.storage.CatalogRepository
import dominikmech.projecttiles.storage.configRoot
import dominikmech.projecttiles.storage.parseCatalog
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreTest {
    private fun ids(): () -> String {
        var n = 0
        return { "id${++n}" }
    }

    private fun tempDir(): Path = Files.createTempDirectory("project-tiles-test").also { it.toFile().deleteOnExit() }

    @Test
    fun `adds projects with trimmed fields and derives a name from the path`() {
        val catalog = ProjectCatalog(null, ids())
        val p = catalog.addProject(ProjectInput(name = "  ", path = "C:\\Dev\\MyGame\\", description = " x ", languages = listOf(" C# ", "")))
        assertEquals("MyGame", p.name)
        assertEquals("x", p.description)
        assertEquals(listOf("C#"), p.languages)
        assertNull(p.logo)
    }

    @Test
    fun `finds projects by path regardless of separators, case and trailing slash`() {
        val catalog = ProjectCatalog(null, ids())
        catalog.addProject(ProjectInput(name = "a", path = "C:\\Dev\\App"))
        assertTrue(catalog.findProjectByPath("c:/dev/app/") != null)
        assertNull(catalog.findProjectByPath("c:/dev/other"))
    }

    @Test
    fun `moves projects between collections at a given index`() {
        val catalog = ProjectCatalog(null, ids())
        val work = catalog.addCollection("Work")
        val a = catalog.addProject(ProjectInput(name = "a", path = "/a", collectionId = work.id))
        val b = catalog.addProject(ProjectInput(name = "b", path = "/b", collectionId = work.id))
        val c = catalog.addProject(ProjectInput(name = "c", path = "/c"))
        assertTrue(catalog.moveProject(c.id, work.id, 1))
        assertEquals(listOf(a.id, c.id, b.id), catalog.projects.filter { it.collectionId == work.id }.map { it.id })
        assertTrue(catalog.removeCollection(work.id))
        assertTrue(catalog.projects.all { it.collectionId == null })
    }

    @Test
    fun `normalize drops unsafe ids, bad colours, dangling collections and unsafe logo files`() {
        val data = CatalogData(
            projects = listOf(
                Project("../evil", "x", "/x"),
                Project("ok", "ok", "/ok", color = "red", collectionId = "missing", logo = Logo(Logo.IMAGE, "../../secret.png")),
                Project("ok", "duplicate", "/dup"),
            ),
        )
        val normalized = ProjectCatalog.normalize(data)
        assertEquals(1, normalized.projects.size)
        val p = normalized.projects[0]
        assertNull(p.color)
        assertNull(p.collectionId)
        assertNull(p.logo)
    }

    @Test
    fun `text logos keep at most three graphemes`() {
        assertEquals("🇵🇱👍🏽A", clampGraphemes("🇵🇱👍🏽ABC", 3))
        val catalog = ProjectCatalog(null, ids())
        val p = catalog.addProject(ProjectInput(name = "a", path = "/a", logo = Logo(Logo.EMOJI, "  ABCD ")))
        assertEquals(Logo(Logo.EMOJI, "ABC"), p.logo)
    }

    @Test
    fun `reads a catalog written by the VS Code extension and writes it back unchanged`() {
        val vscodeJson = """{
  "version": 1,
  "collections": [
    {
      "id": "c1",
      "name": "Work",
      "color": "#447099",
      "collapsed": true
    }
  ],
  "projects": [
    {
      "id": "p1",
      "name": "Shop backend",
      "path": "C:\\Dev\\shop-backend",
      "description": "Online shop API",
      "logo": {
        "kind": "emoji",
        "value": "🛒"
      },
      "languages": [
        "PHP",
        "Blade"
      ],
      "color": "#e5534b",
      "collectionId": "c1"
    }
  ]
}"""
        val parsed = ProjectCatalog.normalize(parseCatalog(vscodeJson))
        val dir = tempDir()
        val repo = CatalogRepository(dir.resolve("projects.json"))
        repo.save(parsed)
        assertEquals(vscodeJson, Files.readString(dir.resolve("projects.json")))
        assertEquals(parsed, ProjectCatalog.normalize(repo.load()))
        assertNull("own write is not reported as an external change", repo.loadIfChangedExternally())
    }

    @Test
    fun `parser tolerates wrong types`() {
        val data = parseCatalog("""{"projects":[{"id":"a","path":"/a","name":5,"languages":"x"},{"id":1,"path":"/b"},"junk"],"collections":{}}""")
        assertEquals(1, data.projects.size)
        assertEquals("", data.projects[0].name)
        assertNull(data.projects[0].languages)
    }

    @Test
    fun `weighs languages by bytes and skips data files and ignored directories`() {
        val root = tempDir()
        Files.createDirectories(root.resolve("Assets"))
        Files.createDirectories(root.resolve("Library"))
        Files.writeString(root.resolve("Assets/Player.cs"), "x".repeat(300))
        Files.writeString(root.resolve("Assets/Enemy.cs"), "x".repeat(100))
        Files.writeString(root.resolve("Assets/Water.shader"), "x".repeat(100))
        Files.writeString(root.resolve("Assets/Scene.unity"), "x".repeat(9000))
        Files.writeString(root.resolve("Library/huge.cs"), "x".repeat(100_000))
        val shares = LanguageDetector(listOf("Library"), 100).detect(root)
        assertEquals(listOf("C#" to 80.0, "ShaderLab" to 20.0), shares.map { it.name to it.percent })
    }

    @Test
    fun `maps special file names and manual overrides like the VS Code version`() {
        assertEquals("Dockerfile", LanguageTable.forFileName("Dockerfile")?.name)
        assertEquals("CMake", LanguageTable.forFileName("CMakeLists.txt")?.name)
        assertEquals("TypeScript", LanguageTable.forFileName("types.d.ts")?.name)
        assertEquals("Blade", LanguageTable.forFileName("view.blade.php")?.name)
        assertNull(LanguageTable.forFileName("data.json"))
        assertNull(LanguageTable.forFileName(".gitignore"))
        val shares = LanguageDetector.sharesFromNames(listOf("c#", "Brainfuck", "C#"))
        assertEquals(2, shares.size)
        assertEquals("C#", shares[0].name)
        assertEquals("#178600", shares[0].color)
        assertEquals("#8b949e", shares[1].color)
        assertEquals(50.0, shares[0].percent, 0.0)
    }

    @Test
    fun `parses git output`() {
        val line = listOf("abc1234", "Fix: thing", "2 hours ago", "Dominik").joinToString("\u001f") + "\n"
        assertEquals("Fix: thing", GitInfoProvider.parseCommitLine(line)?.subject)
        assertNull(GitInfoProvider.parseCommitLine(""))
        assertEquals(2 to 5, GitInfoProvider.parseAheadBehind("2\t5\n"))
        assertNull(GitInfoProvider.parseAheadBehind("fatal: no upstream"))
    }

    @Test
    fun `finds the volume a project lives on, like the VS Code extension`() {
        assertEquals("D:\\", volumeRoot("D:\\Projects\\shop", "Windows 11"))
        assertEquals("\\\\nas\\code\\", volumeRoot("\\\\nas\\code\\shop", "Windows 11"))
        assertEquals("/Volumes/External", volumeRoot("/Volumes/External/dev/shop", "Mac OS X"))
        assertEquals("/", volumeRoot("/Users/a/dev/shop", "Mac OS X"))
        assertEquals("/media/a/USB", volumeRoot("/media/a/USB/shop", "Linux"))
        assertEquals("/run/media/a/USB", volumeRoot("/run/media/a/USB/shop", "Linux"))
        assertEquals("/mnt/nas", volumeRoot("/mnt/nas/shop", "Linux"))
        assertEquals("/", volumeRoot("/home/a/shop", "Linux"))
    }

    @Test
    fun `tells a deleted folder from an existing one`() {
        val dir = tempDir()
        assertNull(unavailability(dir.toString()))
        assertEquals(Unavailable.DELETED, unavailability(dir.resolve("gone").toString()))
    }

    @Test
    fun `shared directory matches the VS Code extension`() {
        assertEquals(Paths.get("C:\\Users\\a\\AppData\\Roaming"), configRoot(mapOf("APPDATA" to "C:\\Users\\a\\AppData\\Roaming"), "Windows 10", "C:\\Users\\a"))
        assertEquals(Paths.get("/Users/a/Library/Application Support"), configRoot(emptyMap(), "Mac OS X", "/Users/a"))
        assertEquals(Paths.get("/cfg"), configRoot(mapOf("XDG_CONFIG_HOME" to "/cfg"), "Linux", "/home/a"))
        assertEquals(Paths.get("/home/a/.config"), configRoot(emptyMap(), "Linux", "/home/a"))
    }
}
