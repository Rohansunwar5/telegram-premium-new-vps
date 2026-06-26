import { NextFunction, Request, Response } from 'express';
import { BookmarkRepository } from '../repository/bookmark.repository';
import { S3Service } from '../services/s3.service';
import { ChannelService } from '../services/channel.service';
import BookmarkService from '../services/bookmark.service';
import { UserRepository } from '../repository/user.repository';

const bookmarkRepository = new BookmarkRepository();
const s3Service = new S3Service();
const channelService = new ChannelService();
const userRepository = new UserRepository();
const bookmarkService = new BookmarkService(bookmarkRepository, s3Service, channelService, userRepository);


export const createBookmark = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { channelName, channelId, alertTime, alertDays, triggerWords, stats } = req.body;

  const response = await bookmarkService.bookmarkChannel({
    userId,
    channelName,
    channelId,
    alertTime,
    alertDays,
    triggerWords,
    seedStats: stats
  });

  next(response);
};

export const updateBookmark = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;
  const { alertTime, alertDays, isActive, triggerWords } = req.body;

  const response = await bookmarkService.updateBookmarkSettings({
    userId,
    bookmarkId,
    alertTime,
    alertDays,
    isActive,
    triggerWords
  });

  next(response);
};

export const deleteBookmark = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.deleteBookmark(userId, bookmarkId);

  next(response);
};

export const getUserBookmarks = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;

  const response = await bookmarkService.getUserBookmarkslist(userId);

  next(response);
};


export const pauseBookmark = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.pauseBookmark(userId, bookmarkId);

  next(response);
};

export const resumeBookmark = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.resumeBookmark(userId, bookmarkId);

  next(response);
};

export const triggerScrape = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.triggerManualScrape(userId, bookmarkId);

  next(response);
};

export const triggerAlert = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.triggerManualAlert(userId, bookmarkId);

  next(response);
};


export const getBookmarkStatus = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.getBookmarkStatus(userId, bookmarkId);

  next(response);
};


export const manualScrape = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  // Verify bookmark belongs to user
  const bookmark = await bookmarkRepository.getBookmarkById(bookmarkId);
  if (!bookmark || bookmark.userId.toString() !== userId) {
    return next({ error: 'Bookmark not found or unauthorized' });
  }

  // Trigger immediate scrape
  const response = await bookmarkService.processScrapeJob(
    bookmarkId,
    bookmark.channelId,
    bookmark.channelName
  );

  next(response);
};

export const getBookmarkSummary = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  // Verify bookmark belongs to user
  const bookmark = await bookmarkRepository.getBookmarkById(bookmarkId);
  if (!bookmark || bookmark.userId.toString() !== userId) {
    return next({ error: 'Bookmark not found or unauthorized' });
  }

  // Process alert manually
  const response = await bookmarkService.processAlertJob(bookmarkId);

  next(response);
};

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const stats = await bookmarkService.getBookmarkDashboardStats(bookmarkId, userId);

  next(stats);
};

export const getAllUserDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;

  const stats = await bookmarkService.getAllUserDashboardStats(userId);

  next(stats);
};

export const getBookmarkScrapeData = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;
  const { days, limit, page } = req.query;

  const response = await bookmarkService.getBookmarkScrapeData({
    userId,
    bookmarkId,
    days: days ? parseInt(days as string) : 2,
    limit: limit ? parseInt(limit as string) : undefined,
    page: page ? parseInt(page as string) : 1
  });

  next(response);
};

export const getBookmarkById = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { bookmarkId } = req.params;

  const response = await bookmarkService.getBookmarkById(userId, bookmarkId);

  next(response);
};
