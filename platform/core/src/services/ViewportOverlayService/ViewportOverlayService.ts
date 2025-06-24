import { PubSubService } from "../_shared/pubSubServiceInterface"

class ViewportOverlayService extends PubSubService{
  static EVENTS = {
    STATE_CHANGE: 'event::ViewportOverlayService:stateChanged'
  }

  public static REGISTRATION = {
    name: 'viewportOverlayService',
    altName: 'ViewportOverlayService',
    create: ({ configuration = {} }) => {
      return new ViewportOverlayService()
    }
  }

  show = true

  constructor() {
    super(ViewportOverlayService.EVENTS)
  }

  public getShow() {
    return this.show
  }

  public toggleShow() {
    this.show = !this.show

    this._broadcastEvent(ViewportOverlayService.EVENTS.STATE_CHANGE, {
      changeType: 'toggle show'
    })
  }
}

export default ViewportOverlayService
