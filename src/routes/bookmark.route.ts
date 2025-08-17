import { Router } from "express";
import isLoggedIn from "../middlewares/isLoggedIn.middleware";
import { asyncHandler } from "../utils/asynchandler";
import { createBookmark, deleteBookmark, getBookmarkSummary, getUserBookmarks, manualScrape, pauseBookmark, resumeBookmark, triggerAlert, updateBookmark } from "../controllers/bookmark.controller";

const bookmarkRouter = Router();

bookmarkRouter.post('/', isLoggedIn, asyncHandler(createBookmark));
bookmarkRouter.put('/:bookmarkId', isLoggedIn, asyncHandler(updateBookmark));
bookmarkRouter.delete('/:bookmarkId', isLoggedIn, asyncHandler(deleteBookmark));
bookmarkRouter.get('/bookmarks', isLoggedIn, asyncHandler(getUserBookmarks));
bookmarkRouter.post('/:bookmarkId/scrape', isLoggedIn, asyncHandler(manualScrape));
bookmarkRouter.post('/:bookmarkId/summary', isLoggedIn, asyncHandler(getBookmarkSummary));

bookmarkRouter.post('/:bookmarkId/pause', isLoggedIn, asyncHandler(pauseBookmark));
bookmarkRouter.post('/"bookmarkId/resume', isLoggedIn, asyncHandler(resumeBookmark));
bookmarkRouter.post('/:bookmarkId/alert', isLoggedIn, asyncHandler(triggerAlert));

export default bookmarkRouter;