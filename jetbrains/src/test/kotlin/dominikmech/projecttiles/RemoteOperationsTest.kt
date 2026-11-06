package dominikmech.projecttiles

import dominikmech.projecttiles.domain.Project
import dominikmech.projecttiles.domain.ProjectMetadata
import dominikmech.projecttiles.services.GitInfoProvider
import dominikmech.projecttiles.services.LanguageDetector
import dominikmech.projecttiles.services.LogoStore
import dominikmech.projecttiles.services.MetadataOptions
import dominikmech.projecttiles.services.MetadataService
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteOperationsTest {
    private fun git(dir: Path, vararg args: String) {
        val process = ProcessBuilder(listOf("git", "-c", "core.autocrlf=false") + args).directory(dir.toFile()).redirectErrorStream(true).apply {
            environment().putAll(mapOf("GIT_AUTHOR_NAME" to "Test", "GIT_AUTHOR_EMAIL" to "t@example.com", "GIT_COMMITTER_NAME" to "Test", "GIT_COMMITTER_EMAIL" to "t@example.com"))
        }.start()
        val output = process.inputStream.readAllBytes().decodeToString()
        check(process.waitFor() == 0) { "git ${args.joinToString(" ")}: $output" }
    }

    private fun commit(repo: Path, file: String) {
        Files.writeString(repo.resolve(file), file)
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "Add $file")
    }

    /** A clone with its "server" (a bare repository) and a second clone standing in for a teammate. */
    private fun setup(): Pair<Path, Path> {
        val root = Files.createTempDirectory("project-tiles-remote").also { it.toFile().deleteOnExit() }
        git(root, "init", "-q", "--bare", "-b", "main", "server.git")
        git(root, "clone", "-q", "server.git", "local")
        val local = root.resolve("local")
        commit(local, "a.txt")
        git(local, "push", "-q", "-u", "origin", "main")
        git(root, "clone", "-q", "server.git", "teammate")
        return local to root.resolve("teammate")
    }

    private fun service() = MetadataService(
        GitInfoProvider(fetchRemote = { true }),
        { LanguageDetector(emptyList(), 100) },
        LogoStore(Files.createTempDirectory("project-tiles-logos")),
        null,
        MetadataOptions(gitTtlMs = { 0 }, languagesTtlMs = { 0 }),
    )

    private fun project(dir: Path) = Project("p1", "Repo", dir.toString())

    @Test
    fun `pushes local commits and the tile shows nothing left to push`() = runBlocking {
        val (local, _) = setup()
        commit(local, "b.txt")
        var meta: ProjectMetadata? = null
        val result = service().runRemote(project(local), "push") { _, m -> meta = m }
        assertTrue(result.error, result.ok)
        assertEquals(listOf(0, 0, true), listOf(meta?.git?.sync?.ahead, meta?.git?.sync?.behind, meta?.git?.sync?.fetched))
    }

    @Test
    fun `fetch reveals new remote commits and pull brings them in`() = runBlocking {
        val (local, teammate) = setup()
        commit(teammate, "c.txt")
        git(teammate, "push", "-q")
        val metadata = service()
        var meta: ProjectMetadata? = null
        assertTrue(metadata.runRemote(project(local), "fetch") { _, m -> meta = m }.ok)
        assertEquals(1, meta?.git?.sync?.behind)
        assertTrue(metadata.runRemote(project(local), "pull") { _, m -> meta = m }.ok)
        assertEquals(0, meta?.git?.sync?.behind)
        assertEquals("Add c.txt", meta?.git?.commit?.subject)
    }

    @Test
    fun `pull refuses to merge diverged histories and reports the reason`() = runBlocking {
        val (local, teammate) = setup()
        commit(teammate, "c.txt")
        git(teammate, "push", "-q")
        commit(local, "d.txt")
        val result = service().runRemote(project(local), "pull") { _, _ -> }
        assertFalse(result.ok)
        assertTrue(result.error, Regex("fast-forward|diverg", RegexOption.IGNORE_CASE).containsMatchIn(result.error))
    }
}
