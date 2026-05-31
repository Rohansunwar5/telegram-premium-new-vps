import { Router } from 'express';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';
import { asyncHandler } from '../utils/asynchandler';
import { createBookmark, deleteBookmark, getAllUserDashboardStats, getBookmarkById, getBookmarkScrapeData, getBookmarkSummary, getDashboardStats, getUserBookmarks, manualScrape, pauseBookmark, resumeBookmark, triggerAlert, updateBookmark } from '../controllers/bookmark.controller';

const bookmarkRouter = Router();

bookmarkRouter.post('/', isLoggedIn, asyncHandler(createBookmark));
bookmarkRouter.put('/:bookmarkId', isLoggedIn, asyncHandler(updateBookmark));
bookmarkRouter.delete('/:bookmarkId', isLoggedIn, asyncHandler(deleteBookmark));
bookmarkRouter.get('/bookmarks', isLoggedIn, asyncHandler(getUserBookmarks));
bookmarkRouter.get('/:bookmarkId', isLoggedIn, asyncHandler(getBookmarkById));

bookmarkRouter.post('/:bookmarkId/scrape', isLoggedIn, asyncHandler(manualScrape));
bookmarkRouter.post('/:bookmarkId/summary', isLoggedIn, asyncHandler(getBookmarkSummary));

bookmarkRouter.post('/:bookmarkId/pause', isLoggedIn, asyncHandler(pauseBookmark));
bookmarkRouter.post('/"bookmarkId/resume', isLoggedIn, asyncHandler(resumeBookmark));
bookmarkRouter.post('/:bookmarkId/alert', isLoggedIn, asyncHandler(triggerAlert));

bookmarkRouter.get('/:bookmarkId/dashboard-stats', isLoggedIn, asyncHandler(getDashboardStats));
bookmarkRouter.get('/user-dashboard-stats', isLoggedIn, asyncHandler(getAllUserDashboardStats));
bookmarkRouter.get('/:bookmarkId/scrape-data', isLoggedIn, asyncHandler(getBookmarkScrapeData));

export default bookmarkRouter;