<?php
namespace ElementorPro\Modules\AssetsManager\AssetTypes\AdminMenuItems;

use ElementorPro\Modules\Tiers\AdminMenuItems\Base_Promotion_Item;
use ElementorPro\License\API;
use ElementorPro\Plugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Custom_Fonts_Promotion_Menu_Item extends Base_Promotion_Item {
	public function get_name(): string {
		return 'custom-fonts-promotion';
	}

	public function get_position(): ?int {
		return null;
	}

	public function get_cta_url(): string {
		$connect_url = Plugin::instance()->license_admin->get_connect_url( [
			'utm_source' => 'wp-custom-fonts',
			'utm_medium' => 'wp-dash',
			'utm_campaign' => 'connect-and-activate-license',
		] );

		$renew_url = 'https://go.elementor.com/renew-custom-fonts/';

		return API::is_license_expired()
			? $renew_url
			: $connect_url;
	}

	public function get_cta_text(): string {
		return API::is_license_expired()
			? esc_html__( 'Renew now', 'elementor-pro' )
			: esc_html__( 'Connect & Activate', 'elementor-pro' );
	}

	public function get_label(): string {
		return esc_html__( 'Custom Fonts', 'elementor-pro' );
	}

	public function get_page_title(): string {
		return esc_html__( 'Custom Fonts', 'elementor-pro' );
	}

	public function get_promotion_title(): string {
		return esc_html__( 'Add Your Custom Fonts', 'elementor-pro' );
	}

	public function get_promotion_description(): string {
		return esc_html__(
			'Custom Fonts allows you to add your self-hosted fonts and use them on your Elementor projects to create a unique brand language.',
			'elementor-pro'
		);
	}

	/**
	 * @deprecated use get_promotion_description instead
	 * @return void
	 */
	public function render_promotion_description() {
		echo $this->get_promotion_description(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
}
