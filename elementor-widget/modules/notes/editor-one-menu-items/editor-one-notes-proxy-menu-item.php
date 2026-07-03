<?php

namespace ElementorPro\Modules\Notes\EditorOneMenuItems;

use Elementor\Core\Admin\EditorOneMenu\Interfaces\Menu_Item_Interface;
use Elementor\Core\Admin\Menu\Interfaces\Admin_Menu_Item_With_Page;
use Elementor\Modules\EditorOne\Classes\Menu_Config;
use ElementorPro\Modules\Notes\Admin_Page;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Editor_One_Notes_Proxy_Menu_Item implements Menu_Item_Interface, Admin_Menu_Item_With_Page {

	private Admin_Page $admin_page;

	public function __construct( Admin_Page $admin_page ) {
		$this->admin_page = $admin_page;
	}

	public function get_page_title(): string {
		return esc_html__( 'Notes Proxy', 'elementor-pro' );
	}

	public function get_capability(): string {
		return 'read';
	}

	public function get_label(): string {
		return esc_html__( 'Notes Proxy', 'elementor-pro' );
	}

	public function get_parent_slug(): string {
		return Menu_Config::ELEMENTOR_MENU_SLUG;
	}

	public function is_visible(): bool {
		return false;
	}

	public function get_position(): int {
		return 999;
	}

	public function get_slug(): string {
		return Admin_Page::PAGE_ID;
	}

	public function get_group_id(): string {
		return Menu_Config::SYSTEM_GROUP_ID;
	}

	public function render(): void {
		$this->admin_page->on_page_load();
	}
}
